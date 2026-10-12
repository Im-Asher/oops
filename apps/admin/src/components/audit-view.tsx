"use client";

// 审计查询视图（task 1.3）：antd 表格 + 过滤区 + 展开前后值明细。
// 必须为 client 组件：Table/Select 复合组件静态属性与交互态在 RSC 上不可用（1.2 spike 纪律）。
// 交互约定：控件态与已应用态分离——「查询」按钮提交过滤（避免逐键请求），
// 分页变化直接应用；取数 effect 内仅在异步续体中 setState（react-hooks/set-state-in-effect）。
import { useCallback, useEffect, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Button, DatePicker, Input, Select, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

interface AuditRow {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  note?: string;
  createdAt: string;
}

interface AuditPage {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

const ACTION_OPTIONS = [
  "user.status_change",
  "invite.create",
  "invite.revoke",
  "credits.adjust",
  "pricing.update",
  "agent.toggle",
  "model.config",
];

const TARGET_OPTIONS = ["user", "invite_code", "credit_price", "agent", "model_config"];

interface AppliedFilters {
  action?: string;
  targetType?: string;
  operator?: string;
  range: [Dayjs, Dayjs] | null;
}

export default function AuditView() {
  const t = useTranslations("common.section.audit");

  // 控件态（自由编辑）与已应用态（驱动取数）分离
  const [actionSel, setActionSel] = useState<string | undefined>();
  const [targetSel, setTargetSel] = useState<string | undefined>();
  const [operatorInput, setOperatorInput] = useState("");
  const [rangeSel, setRangeSel] = useState<[Dayjs, Dayjs] | null>(null);
  const [applied, setApplied] = useState<AppliedFilters>({ range: null });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 纯取数函数：不含任何 setState，供 effect 以回调方式应用结果
  const fetchAudit = useCallback(async (): Promise<AuditPage> => {
    const params = new URLSearchParams();
    if (applied.action) params.set("action", applied.action);
    if (applied.targetType) params.set("targetType", applied.targetType);
    if (applied.operator) params.set("adminUserId", applied.operator);
    if (applied.range) {
      params.set("from", applied.range[0].startOf("day").toISOString());
      params.set("to", applied.range[1].endOf("day").toISOString());
    }
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const res = await fetch(`/api/admin/audit?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as AuditPage;
  }, [applied, page, pageSize]);

  useEffect(() => {
    let active = true;
    fetchAudit()
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
  }, [fetchAudit, t]);

  const submitFilters = () => {
    setApplied({
      action: actionSel,
      targetType: targetSel,
      operator: operatorInput.trim() || undefined,
      range: rangeSel,
    });
    setPage(1);
    setLoading(true);
  };

  const resetFilters = () => {
    setActionSel(undefined);
    setTargetSel(undefined);
    setOperatorInput("");
    setRangeSel(null);
    setApplied({ range: null });
    setPage(1);
    setLoading(true);
  };

  const columns: ColumnsType<AuditRow> = [
    {
      title: t("columnTime"),
      dataIndex: "createdAt",
      width: 180,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
    },
    { title: t("columnOperator"), dataIndex: "adminUserId", width: 220 },
    { title: t("columnAction"), dataIndex: "action", width: 180 },
    {
      title: t("columnTarget"),
      key: "target",
      width: 220,
      render: (_, row) =>
        row.targetId ? `${row.targetType} / ${row.targetId}` : row.targetType,
    },
    {
      title: t("columnNote"),
      dataIndex: "note",
      render: (v?: string) => v ?? "—",
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          placeholder={t("filterOperator")}
          value={operatorInput}
          style={{ width: 240 }}
          onChange={(e) => setOperatorInput(e.target.value)}
          onPressEnter={submitFilters}
        />
        <Select
          allowClear
          placeholder={t("filterAction")}
          value={actionSel}
          style={{ width: 200 }}
          options={ACTION_OPTIONS.map((v) => ({ value: v, label: v }))}
          onChange={setActionSel}
        />
        <Select
          allowClear
          placeholder={t("filterTarget")}
          value={targetSel}
          style={{ width: 180 }}
          options={TARGET_OPTIONS.map((v) => ({ value: v, label: v }))}
          onChange={setTargetSel}
        />
        <DatePicker.RangePicker value={rangeSel} onChange={(v) => setRangeSel((v?.[0] && v?.[1] ? [v[0], v[1]] : null) as [Dayjs, Dayjs] | null)} />
        <Button type="primary" onClick={submitFilters}>
          {t("query")}
        </Button>
        <Button onClick={resetFilters}>{t("reset")}</Button>
      </Space>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

      <Table<AuditRow>
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
        expandable={{
          expandedRowRender: (row) => (
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
              {JSON.stringify({ before: row.before ?? null, after: row.after ?? null }, null, 2)}
            </pre>
          ),
        }}
      />
    </div>
  );
}
