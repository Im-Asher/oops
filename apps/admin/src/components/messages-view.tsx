"use client";

// 消息管理视图（task 5.5）：下发表单（全体广播 / 定向选人）+ 消息列表 + 已读明细 + 撤回。
// 必须为 client 组件：Table/Form/Select 复合组件的静态属性与交互态在 RSC 上不可用。
// 交互约定沿用既有两条：控件态与已应用态分离（避免逐键请求）；取数 effect 内
// 只在异步续体中 setState（react-hooks/set-state-in-effect）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

interface MessageRow {
  id: string;
  source: string;
  category: string;
  level: string;
  title: string;
  body: string;
  audience: string;
  createdBy: string | null;
  revokedAt: string | null;
  createdAt: string;
  targetCount: number;
  readCount: number;
}

interface MessagePage {
  items: MessageRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface MessageDetail {
  notification: MessageRow;
  readBy: Array<{
    userId: string;
    username: string;
    displayName: string | null;
    readAt: string;
  }>;
}

interface AppliedFilters {
  source?: string;
  keyword?: string;
  revoked: "active" | "revoked" | "all";
}

interface SendFormValues {
  audience: "all" | "users";
  userIds?: string[];
  title: string;
  body: string;
  level: "info" | "warning" | "critical";
  note?: string;
}

/** 类别 → Tag 色彩/词典键（系统两类由积分触发，admin 两类由本表单产生）。 */
const CATEGORY_TAG: Record<string, { color: string; key: string }> = {
  "credits.low": { color: "orange", key: "categoryCreditsLow" },
  "credits.exhausted": { color: "red", key: "categoryCreditsExhausted" },
  "admin.broadcast": { color: "purple", key: "categoryAdminBroadcast" },
  "admin.direct": { color: "blue", key: "categoryAdminDirect" },
};

const LEVEL_TAG: Record<string, { color: string; key: string }> = {
  info: { color: "default", key: "levelInfo" },
  warning: { color: "orange", key: "levelWarning" },
  critical: { color: "red", key: "levelCritical" },
};

export default function MessagesView() {
  const t = useTranslations("common.section.messages");
  const { message } = App.useApp();
  const [form] = Form.useForm<SendFormValues>();

  // ── 下发表单 ──
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: string }>>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sending, setSending] = useState(false);
  const audience = Form.useWatch("audience", form) ?? "all";
  const pickedUsers = Form.useWatch("userIds", form) ?? [];

  const searchUsers = (q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const keyword = q.trim();
      if (!keyword) return;
      try {
        const res = await fetch(
          `/api/admin/users?search=${encodeURIComponent(keyword)}&pageSize=10`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: Array<{ id: string; username: string; displayName: string | null }>;
        };
        setUserOptions(
          data.items.map((u) => ({
            label: `${u.username}${u.displayName ? `（${u.displayName}）` : ""} · ${u.id.slice(0, 8)}`,
            value: u.id,
          })),
        );
      } catch {
        setUserOptions([]);
      }
    }, 250);
  };

  const submitSend = async (values: SendFormValues) => {
    if (values.audience === "users" && (values.userIds?.length ?? 0) === 0) {
      // 前端先拦一道：服务端同样会拒（422），这里只为少一次往返并给出准确提示
      message.error(t("audienceEmpty"));
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          audience: values.audience,
          userIds: values.userIds,
          title: values.title,
          body: values.body,
          level: values.level,
          note: values.note,
        }),
      });
      if (!res.ok) {
        message.error(t("sendFailed"));
        return;
      }
      const data = (await res.json()) as { targetCount: number };
      message.success(t("sendDone", { count: data.targetCount }));
      form.resetFields();
      setPage(1);
      setLoading(true);
      setReload((n) => n + 1);
    } catch {
      message.error(t("sendFailed"));
    } finally {
      setSending(false);
    }
  };

  // ── 列表：控件态与已应用态分离 ──
  const [sourceSel, setSourceSel] = useState<string | undefined>();
  const [keywordInput, setKeywordInput] = useState("");
  const [revokedSel, setRevokedSel] = useState<"active" | "revoked" | "all">("active");
  const [applied, setApplied] = useState<AppliedFilters>({ revoked: "active" });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // 纯取数函数：不含 setState，供 effect 以回调方式应用结果
  const fetchMessages = useCallback(async (): Promise<MessagePage> => {
    const params = new URLSearchParams({ revoked: applied.revoked });
    if (applied.source) params.set("source", applied.source);
    if (applied.keyword) params.set("keyword", applied.keyword);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const res = await fetch(`/api/admin/messages?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as MessagePage;
  }, [applied, page, pageSize]);

  useEffect(() => {
    let active = true;
    fetchMessages()
      .then((data) => {
        if (!active) return;
        setRows(data.items);
        setTotal(data.total);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(t("loadFailed"));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchMessages, reload, t]);

  // ── 详情（已读明细）与撤回 ──
  const [detail, setDetail] = useState<MessageDetail | null>(null);

  const openDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/messages/${id}`);
      if (!res.ok) {
        message.error(t("loadDetailFailed"));
        return;
      }
      setDetail((await res.json()) as MessageDetail);
    } catch {
      message.error(t("loadDetailFailed"));
    }
    // message 引用稳定（antd 记忆化）
  }, [message, t]);

  const revoke = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/messages/${id}/revoke`, { method: "POST" });
      if (!res.ok) {
        message.error(t("revokeFailed"));
        return;
      }
      message.success(t("revokeDone"));
      setLoading(true);
      setReload((n) => n + 1);
    } catch {
      message.error(t("revokeFailed"));
    }
  }, [message, t]);

  const columns: ColumnsType<MessageRow> = useMemo(
    () => [
      { title: t("columnTitle"), dataIndex: "title", ellipsis: true },
      {
        title: t("columnSource"),
        dataIndex: "source",
        width: 96,
        render: (v: string) => (v === "admin" ? t("sourceAdmin") : t("sourceSystem")),
      },
      {
        title: t("columnCategory"),
        dataIndex: "category",
        width: 120,
        render: (v: string) => {
          const tag = CATEGORY_TAG[v];
          return <Tag color={tag?.color}>{tag ? t(tag.key) : v}</Tag>;
        },
      },
      {
        title: t("columnLevel"),
        dataIndex: "level",
        width: 88,
        render: (v: string) => {
          const tag = LEVEL_TAG[v];
          return <Tag color={tag?.color}>{tag ? t(tag.key) : v}</Tag>;
        },
      },
      {
        title: t("columnTargetCount"),
        dataIndex: "targetCount",
        width: 140,
        render: (v: number, row: MessageRow) => (
          <Space size={4}>
            <span>{v}</span>
            {/* 已撤回消息保留历史统计，但显式挂标签，避免被误读为「用户仍在看」（D4） */}
            {row.revokedAt ? <Tag>{t("revokedTag")}</Tag> : null}
          </Space>
        ),
      },
      { title: t("columnReadCount"), dataIndex: "readCount", width: 100 },
      {
        title: t("columnCreatedAt"),
        dataIndex: "createdAt",
        width: 180,
        render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
      },
      {
        title: t("columnAction"),
        key: "action",
        width: 170,
        render: (_: unknown, row: MessageRow) => (
          <Space size={4}>
            <Button onClick={() => void openDetail(row.id)} size="small">
              {t("detailTitle")}
            </Button>
            {row.revokedAt ? null : (
              <Popconfirm
                cancelText={t("confirmCancel")}
                okText={t("confirmOk")}
                title={t("confirmRevoke")}
                onConfirm={() => void revoke(row.id)}
              >
                <Button danger size="small">
                  {t("revoke")}
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [openDetail, revoke, t],
  );

  const readByColumns: ColumnsType<MessageDetail["readBy"][number]> = [
    { title: t("columnUsername"), dataIndex: "username" },
    {
      title: t("columnDisplayName"),
      dataIndex: "displayName",
      render: (v: string | null) => v ?? "—",
    },
    {
      title: t("columnReadAt"),
      dataIndex: "readAt",
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small" title={t("composeTitle")}>
        <Form<SendFormValues>
          form={form}
          initialValues={{ audience: "all", level: "info" }}
          layout="vertical"
          onFinish={(v) => void submitSend(v)}
        >
          <Form.Item label={t("fieldAudience")} name="audience">
            <Select
              options={[
                { label: t("audienceAll"), value: "all" },
                { label: t("audienceUsers"), value: "users" },
              ]}
            />
          </Form.Item>
          {audience === "users" ? (
            <Form.Item
              extra={t("userSelected", { count: pickedUsers.length })}
              label={t("fieldUsers")}
              name="userIds"
              rules={[
                {
                  validator: async (_: unknown, value: string[] | undefined) => {
                    if (!value || value.length === 0) throw new Error(t("audienceEmpty"));
                  },
                },
              ]}
            >
              <Select
                mode="multiple"
                onSearch={searchUsers}
                options={userOptions}
                placeholder={t("userSearchPlaceholder")}
                showSearch
              />
            </Form.Item>
          ) : null}
          <Form.Item label={t("fieldTitle")} name="title" rules={[{ required: true }]}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item label={t("fieldBody")} name="body" rules={[{ required: true }]}>
            <Input.TextArea maxLength={2000} rows={3} />
          </Form.Item>
          <Form.Item label={t("fieldLevel")} name="level">
            <Select
              options={[
                { label: t("levelInfo"), value: "info" },
                { label: t("levelWarning"), value: "warning" },
                { label: t("levelCritical"), value: "critical" },
              ]}
            />
          </Form.Item>
          <Form.Item label={t("fieldNote")} name="note">
            <Input maxLength={200} />
          </Form.Item>
          <Button htmlType="submit" loading={sending} type="primary">
            {sending ? t("sending") : t("send")}
          </Button>
        </Form>
      </Card>

      <Card size="small" title={t("listTitle")}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input
            allowClear
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder={t("filterKeyword")}
            style={{ width: 220 }}
            value={keywordInput}
          />
          <Select
            allowClear
            onChange={setSourceSel}
            options={[
              { label: t("sourceSystem"), value: "system" },
              { label: t("sourceAdmin"), value: "admin" },
            ]}
            placeholder={t("filterSource")}
            style={{ width: 140 }}
            value={sourceSel}
          />
          <Select
            onChange={setRevokedSel}
            options={[
              { label: t("revokedActive"), value: "active" },
              { label: t("revokedRevoked"), value: "revoked" },
              { label: t("revokedAll"), value: "all" },
            ]}
            style={{ width: 140 }}
            value={revokedSel}
          />
          <Button
            onClick={() => {
              setApplied({
                source: sourceSel,
                keyword: keywordInput.trim() || undefined,
                revoked: revokedSel,
              });
              setPage(1);
              setLoading(true);
            }}
            type="primary"
          >
            {t("query")}
          </Button>
          <Button
            onClick={() => {
              setSourceSel(undefined);
              setKeywordInput("");
              setRevokedSel("active");
              setApplied({ revoked: "active" });
              setPage(1);
              setLoading(true);
            }}
          >
            {t("reset")}
          </Button>
        </Space>

        {error ? <Alert message={error} showIcon type="error" /> : null}

        <Table<MessageRow>
          columns={columns}
          dataSource={rows}
          loading={loading}
          locale={{ emptyText: t("noData") }}
          pagination={{
            current: page,
            pageSize,
            showSizeChanger: true,
            total,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
              setLoading(true);
            },
          }}
          rowKey="id"
          size="small"
        />
      </Card>

      {detail ? (
        <Card
          extra={
            <Button onClick={() => setDetail(null)} size="small">
              {t("detailClose")}
            </Button>
          }
          size="small"
          title={t("detailTitle")}
        >
          <Descriptions
            column={2}
            items={[
              { children: detail.notification.title, label: t("columnTitle") },
              { children: detail.notification.body, label: t("columnBody"), span: 2 },
              {
                children: t("detailStats", {
                  target: detail.notification.targetCount,
                  read: detail.notification.readCount,
                }),
                label: t("columnReadCount"),
                span: 2,
              },
              ...(detail.notification.revokedAt
                ? [
                    {
                      children: dayjs(detail.notification.revokedAt).format("YYYY-MM-DD HH:mm"),
                      label: t("revokedTag"),
                    },
                  ]
                : []),
            ]}
            size="small"
          />
          <Table
            columns={readByColumns}
            dataSource={detail.readBy}
            locale={{ emptyText: t("detailNoRead") }}
            pagination={false}
            rowKey="userId"
            size="small"
          />
        </Card>
      ) : null}
    </Space>
  );
}
