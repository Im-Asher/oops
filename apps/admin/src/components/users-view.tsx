"use client";

// 用户管理视图（task 3.3）：antd 搜索框 + 表格 + 启停开关（Popconfirm 确认交互）。
// 纪律同 audit-view：控件态与已应用态分离；取数 effect 内仅在异步续体 setState。
// 停用确认文案明示「即时生效」语义；服务端 422 自禁拒绝按 code 映射词典文案。
import { useCallback, useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  Alert,
  App,
  Button,
  Input,
  Popconfirm,
  Space,
  Switch,
  Table,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

interface UserRow {
  id: string;
  username: string;
  oopsId: string;
  displayName: string | null;
  status: "active" | "disabled";
  role: "user" | "admin";
  creditBalance: number;
  createdAt: string;
}

interface UserPage {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export default function UsersView() {
  const t = useTranslations("common.section.users");
  // 经 App 上下文取 message：静态方法拿不到主题/上下文（antd 告警）
  const { message } = App.useApp();

  // 控件态（自由编辑）与已应用态（驱动取数）分离
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState<string | undefined>();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 纯取数函数：不含任何 setState，供 effect 以回调方式应用结果
  const fetchUsers = useCallback(async (): Promise<UserPage> => {
    const params = new URLSearchParams();
    if (appliedSearch) params.set("search", appliedSearch);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const res = await fetch(`/api/admin/users?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as UserPage;
  }, [appliedSearch, page, pageSize]);

  useEffect(() => {
    let active = true;
    fetchUsers()
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
  }, [fetchUsers, t]);

  const submitSearch = () => {
    setAppliedSearch(searchInput.trim() || undefined);
    setPage(1);
    setLoading(true);
  };

  const resetSearch = () => {
    setSearchInput("");
    setAppliedSearch(undefined);
    setPage(1);
    setLoading(true);
  };

  const applyStatus = async (row: UserRow, status: UserRow["status"]) => {
    try {
      const res = await fetch(`/api/admin/users/${row.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const { user } = (await res.json()) as { user: UserRow };
        setRows((prev) => prev.map((r) => (r.id === row.id ? user : r)));
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      if (body?.error?.code === "SELF_DISABLE_FORBIDDEN") {
        message.error(t("selfDisableForbidden"));
      } else {
        message.error(t("actionFailed"));
      }
    } catch {
      message.error(t("actionFailed"));
    }
  };

  const columns: ColumnsType<UserRow> = [
    { title: t("columnUsername"), dataIndex: "username", width: 160 },
    {
      title: t("columnOopsId"),
      dataIndex: "oopsId",
      width: 150,
      render: (v: string) => `oops_${v}`,
    },
    {
      title: t("columnDisplayName"),
      dataIndex: "displayName",
      width: 140,
      render: (v?: string | null) => v ?? "—",
    },
    {
      title: t("columnRole"),
      dataIndex: "role",
      width: 90,
      render: (v: UserRow["role"]) => (v === "admin" ? t("roleAdmin") : t("roleUser")),
    },
    {
      title: t("columnStatus"),
      dataIndex: "status",
      width: 90,
      render: (v: UserRow["status"]) =>
        v === "active" ? t("statusActive") : t("statusDisabled"),
    },
    {
      title: t("columnBalance"),
      dataIndex: "creditBalance",
      width: 90,
      align: "right",
      render: (v: number) => String(v),
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
      width: 80,
      render: (_, row) => {
        const disabling = row.status === "active";
        return (
          <Popconfirm
            title={disabling ? t("confirmDisable") : t("confirmEnable")}
            okText={t("confirmOk")}
            cancelText={t("confirmCancel")}
            onConfirm={() => void applyStatus(row, disabling ? "disabled" : "active")}
          >
            {/* preventDefault 阻止开关立即翻转：状态以确认后服务端返回为准（antd 确认开关模式） */}
            <Switch
              size="small"
              checked={row.status === "active"}
              onClick={(_checked, e) => e.preventDefault()}
            />
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          placeholder={t("searchPlaceholder")}
          value={searchInput}
          style={{ width: 280 }}
          onChange={(e) => setSearchInput(e.target.value)}
          onPressEnter={submitSearch}
        />
        <Button type="primary" onClick={submitSearch}>
          {t("query")}
        </Button>
        <Button onClick={resetSearch}>{t("reset")}</Button>
      </Space>

      {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}

      <Table<UserRow>
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
