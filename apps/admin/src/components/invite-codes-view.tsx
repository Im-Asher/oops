"use client";

// 邀请码管理视图（task 4.2）：生成表单 + 列表 + 作废按钮（Popconfirm 确认交互）。
// 生成与作废均由服务端同事务落审计；列表状态为 repo 派生值（active/exhausted/expired/revoked）。
import { useCallback, useEffect, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

type DerivedStatus = "active" | "exhausted" | "expired" | "revoked";

interface InviteCodeRow {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  note: string | null;
  createdAt: string;
  status: DerivedStatus;
}

interface InviteCodePage {
  items: InviteCodeRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface GenerateFormValues {
  count: number;
  maxUses: number;
  expiresAt?: Dayjs | null;
  note?: string;
}

/** 状态 → Badge 色彩/词典键映射（与 repo deriveInviteStatus 四态一致）。 */
const STATUS_BADGE: Record<DerivedStatus, { color: string; key: string }> = {
  active: { color: "green", key: "statusActive" },
  exhausted: { color: "orange", key: "statusExhausted" },
  expired: { color: "red", key: "statusExpired" },
  revoked: { color: "default", key: "statusRevoked" },
};

export default function InviteCodesView() {
  const t = useTranslations("common.section.inviteCodes");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<InviteCodeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 生成/作废成功后 bump 触发重拉（避免手动维护行内数据与分页 total 的不一致）
  const [refreshTick, setRefreshTick] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [form] = Form.useForm();

  const fetchCodes = useCallback(async (): Promise<InviteCodePage> => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const res = await fetch(`/api/admin/invite-codes?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as InviteCodePage;
  }, [page, pageSize]);

  useEffect(() => {
    let active = true;
    fetchCodes()
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
  }, [fetchCodes, refreshTick, t]);

  const handleGenerate = async (values: GenerateFormValues) => {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/invite-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          count: values.count,
          maxUses: values.maxUses,
          expiresAt: values.expiresAt ? values.expiresAt.toISOString() : null,
          note: values.note?.trim() || null,
        }),
      });
      if (res.ok) {
        form.resetFields();
        setRefreshTick((n) => n + 1);
        setLoading(true);
        const { codes } = (await res.json()) as { codes: string[] };
        message.success(t("generateDone", { count: codes.length }));
      } else {
        message.error(t("generateFailed"));
      }
    } catch {
      message.error(t("generateFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (row: InviteCodeRow) => {
    try {
      const res = await fetch(`/api/admin/invite-codes/${row.id}/revoke`, {
        method: "POST",
      });
      if (res.ok || res.status === 200) {
        setRefreshTick((n) => n + 1);
        setLoading(true);
        message.success(t("revokeDone"));
      } else {
        message.error(t("revokeFailed"));
      }
    } catch {
      message.error(t("revokeFailed"));
    }
  };

  const columns: ColumnsType<InviteCodeRow> = [
    {
      title: t("columnCode"),
      dataIndex: "code",
      width: 150,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: t("columnStatus"),
      dataIndex: "status",
      width: 100,
      render: (v: DerivedStatus) => (
        <Badge color={STATUS_BADGE[v].color} text={t(STATUS_BADGE[v].key)} />
      ),
    },
    {
      title: t("columnUsage"),
      dataIndex: "usedCount",
      width: 90,
      render: (v: number, row) => `${v} / ${row.maxUses}`,
    },
    {
      title: t("columnExpiresAt"),
      dataIndex: "expiresAt",
      width: 170,
      render: (v: string | null) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : t("permanent")),
    },
    {
      title: t("columnNote"),
      dataIndex: "note",
      ellipsis: true,
      render: (v?: string | null) => v ?? "—",
    },
    {
      title: t("columnCreatedAt"),
      dataIndex: "createdAt",
      width: 170,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: t("columnAction"),
      key: "action",
      width: 90,
      render: (_, row) =>
        row.status === "revoked" ? (
          <Button size="small" disabled>
            {t("revoke")}
          </Button>
        ) : (
          <Popconfirm
            title={t("confirmRevoke")}
            okText={t("confirmOk")}
            cancelText={t("confirmCancel")}
            onConfirm={() => void handleRevoke(row)}
          >
            <Button size="small" danger>
              {t("revoke")}
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <div>
      <Form
        form={form}
        layout="inline"
        onFinish={(values) => void handleGenerate(values as GenerateFormValues)}
        style={{ marginBottom: 16, rowGap: 8 }}
      >
        <Form.Item name="count" initialValue={10} rules={[{ required: true }]}>
          <InputNumber min={1} max={100} placeholder={t("fieldCount")} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="maxUses" initialValue={1}>
          <InputNumber min={1} max={99} placeholder={t("fieldMaxUses")} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="expiresAt">
          <DatePicker showTime placeholder={t("fieldExpiresAt")} />
        </Form.Item>
        <Form.Item name="note">
          <Input placeholder={t("fieldNote")} style={{ width: 200 }} allowClear />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={generating}>
            {t("generate")}
          </Button>
        </Form.Item>
      </Form>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

      <Table<InviteCodeRow>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
            setLoading(true);
          },
        }}
      />
    </div>
  );
}
