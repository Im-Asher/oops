"use client";

// 积分运营视图（task 5.2）：四区块 —— 积分调整表单 / 流水查询 / 余额对账 / 任务定价编辑。
// 调整与改价由服务端同事务落审计；对账口径：余额 == 该用户全部流水合计。
import { useCallback, useEffect, useRef, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

type LedgerType = "freeze" | "settle" | "release" | "grant" | "adjust";
type LedgerStatus = "frozen" | "settled" | "released";

interface LedgerRow {
  id: string;
  userId: string;
  type: LedgerType;
  amount: number;
  status: LedgerStatus | null;
  note: string | null;
  createdAt: string;
}

interface LedgerPage {
  items: LedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface ReconcileResult {
  consistent: boolean;
  total: number;
  mismatches: Array<{ userId: string; username: string; balance: number; ledgerSum: number }>;
}

interface PriceRow {
  key: string;
  credits: number;
  updatedAt: string;
}

interface AdjustFormValues {
  userId: string;
  delta: number;
  note: string;
}

/** 流水类型 → Tag 色彩/词典键。 */
const TYPE_TAG: Record<LedgerType, { color: string; key: string }> = {
  freeze: { color: "orange", key: "typeFreeze" },
  settle: { color: "green", key: "typeSettle" },
  release: { color: "blue", key: "typeRelease" },
  grant: { color: "cyan", key: "typeGrant" },
  adjust: { color: "purple", key: "typeAdjust" },
};

/** 冻结条目生命周期状态 → Tag（grant/adjust 流水无状态，显示 —）。 */
const STATUS_TAG: Record<LedgerStatus, { color: string; key: string }> = {
  frozen: { color: "orange", key: "statusFrozen" },
  settled: { color: "default", key: "statusSettled" },
  released: { color: "default", key: "statusReleased" },
};

export default function PointsView() {
  const t = useTranslations("common.section.points");

  // ── 调整表单：用户远程搜索选项 ──
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [adjusting, setAdjusting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adjustForm] = Form.useForm();

  const handleUserSearch = (q: string) => {
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
        // 搜索失败静默：保留上次选项，提交仍会由服务端校验 userId
      }
    }, 250);
  };

  // ── 流水查询 ──
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterType, setFilterType] = useState<LedgerType | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [ledgerTick, setLedgerTick] = useState(0);

  const fetchLedger = useCallback(async (): Promise<LedgerPage> => {
    const params = new URLSearchParams();
    if (filterUserId.trim()) params.set("userId", filterUserId.trim());
    if (filterType) params.set("type", filterType);
    // to 边界取当天末尾：日期粒度选择应包含结束日全天
    if (range?.[0]) params.set("from", range[0].startOf("day").toISOString());
    if (range?.[1]) params.set("to", range[1].endOf("day").toISOString());
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const res = await fetch(`/api/admin/points/ledger?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as LedgerPage;
  }, [filterUserId, filterType, range, page, pageSize]);

  useEffect(() => {
    let active = true;
    fetchLedger()
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
  }, [fetchLedger, ledgerTick, t]);

  const resetFilters = () => {
    setFilterUserId("");
    setFilterType(undefined);
    setRange(null);
    setPage(1);
    setLoading(true);
  };

  const handleAdjust = async (values: AdjustFormValues) => {
    setAdjusting(true);
    try {
      const res = await fetch("/api/admin/points/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: values.userId,
          delta: values.delta,
          note: values.note.trim(),
        }),
      });
      if (res.ok) {
        const { balance } = (await res.json()) as { balance: number };
        adjustForm.resetFields();
        setUserOptions([]);
        message.success(t("adjustDone", { balance }));
        setLedgerTick((n) => n + 1); // 调整产生流水：联动流水表刷新
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        if (body?.error?.code === "INSUFFICIENT_CREDITS") {
          message.error(t("adjustInsufficient"));
        } else if (body?.error?.code === "adjust_amount_invalid") {
          message.error(t("adjustInvalid"));
        } else {
          message.error(t("adjustFailed"));
        }
      }
    } catch {
      message.error(t("adjustFailed"));
    } finally {
      setAdjusting(false);
    }
  };

  const ledgerColumns: ColumnsType<LedgerRow> = [
    {
      title: t("columnTime"),
      dataIndex: "createdAt",
      width: 170,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
    },
    {
      title: t("columnUser"),
      dataIndex: "userId",
      width: 150,
      render: (v: string) => (
        <Typography.Text code copyable={{ text: v }}>
          {v.slice(0, 8)}
        </Typography.Text>
      ),
    },
    {
      title: t("columnType"),
      dataIndex: "type",
      width: 90,
      render: (v: LedgerType) => <Tag color={TYPE_TAG[v].color}>{t(TYPE_TAG[v].key)}</Tag>,
    },
    {
      title: t("columnAmount"),
      dataIndex: "amount",
      width: 110,
      align: "right",
      render: (v: number) =>
        v > 0 ? (
          <Typography.Text type="success">+{v}</Typography.Text>
        ) : (
          <Typography.Text type="danger">{v}</Typography.Text>
        ),
    },
    {
      title: t("columnStatus"),
      dataIndex: "status",
      width: 100,
      render: (v: LedgerStatus | null) =>
        v ? <Tag color={STATUS_TAG[v].color}>{t(STATUS_TAG[v].key)}</Tag> : "—",
    },
    {
      title: t("columnNote"),
      dataIndex: "note",
      ellipsis: true,
      render: (v?: string | null) => v ?? "—",
    },
  ];

  // ── 对账 ──
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);

  const runReconcile = async () => {
    setReconciling(true);
    try {
      const res = await fetch("/api/admin/points/reconcile");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReconcileResult((await res.json()) as ReconcileResult);
    } catch {
      message.error(t("reconcileFailed"));
    } finally {
      setReconciling(false);
    }
  };

  const reconcileColumns: ColumnsType<ReconcileResult["mismatches"][number]> = [
    { title: t("columnUsername"), dataIndex: "username" },
    {
      title: t("columnUser"),
      dataIndex: "userId",
      render: (v: string) => (
        <Typography.Text code copyable={{ text: v }}>
          {v.slice(0, 8)}
        </Typography.Text>
      ),
    },
    { title: t("columnBalance"), dataIndex: "balance", align: "right" },
    { title: t("columnLedgerSum"), dataIndex: "ledgerSum", align: "right" },
    {
      title: t("columnDiff"),
      key: "diff",
      align: "right",
      render: (_, row) => (
        <Typography.Text type="danger">{row.balance - row.ledgerSum}</Typography.Text>
      ),
    },
  ];

  // ── 定价编辑 ──
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [pricesLoading, setPricesLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingCredits, setEditingCredits] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);

  const fetchPrices = useCallback(async (): Promise<PriceRow[]> => {
    const res = await fetch("/api/admin/points/prices");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { items: PriceRow[] }).items;
  }, []);

  useEffect(() => {
    let active = true;
    fetchPrices()
      .then((items) => {
        if (!active) return;
        setPrices(items);
        setPricesLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setPricesLoading(false);
        message.error(t("loadPricesFailed"));
      });
    return () => {
      active = false;
    };
  }, [fetchPrices, t]);

  const startEdit = (row: PriceRow) => {
    setEditingKey(row.key);
    setEditingCredits(row.credits);
    setEditingNote("");
  };

  const savePrice = async (key: string) => {
    if (editingCredits === null || !Number.isInteger(editingCredits) || editingCredits < 0) {
      message.error(t("priceInvalid"));
      return;
    }
    setSavingPrice(true);
    try {
      const res = await fetch("/api/admin/points/prices", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key,
          credits: editingCredits,
          note: editingNote.trim() || undefined,
        }),
      });
      if (res.ok) {
        message.success(t("priceSaveDone"));
        setEditingKey(null);
        setPricesLoading(true);
        const items = await fetchPrices();
        setPrices(items);
        setPricesLoading(false);
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        message.error(body?.error?.code === "pricing_invalid" ? t("priceInvalid") : t("priceSaveFailed"));
      }
    } catch {
      message.error(t("priceSaveFailed"));
    } finally {
      setSavingPrice(false);
    }
  };

  const priceColumns: ColumnsType<PriceRow> = [
    {
      title: t("columnPriceKey"),
      dataIndex: "key",
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: t("columnPrice"),
      dataIndex: "credits",
      width: 260,
      render: (v: number, row) =>
        editingKey === row.key ? (
          <Space.Compact>
            <InputNumber
              min={0}
              precision={0}
              value={editingCredits}
              onChange={(nv) => setEditingCredits(nv)}
              style={{ width: 110 }}
            />
            <Input
              placeholder={t("priceNote")}
              value={editingNote}
              onChange={(e) => setEditingNote(e.target.value)}
              style={{ width: 140 }}
              maxLength={200}
            />
          </Space.Compact>
        ) : (
          v
        ),
    },
    {
      title: t("columnPriceUpdatedAt"),
      dataIndex: "updatedAt",
      width: 170,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: t("columnAction"),
      key: "action",
      width: 160,
      render: (_, row) =>
        editingKey === row.key ? (
          <Space>
            <Button
              type="primary"
              size="small"
              loading={savingPrice}
              onClick={() => void savePrice(row.key)}
            >
              {t("save")}
            </Button>
            <Button size="small" onClick={() => setEditingKey(null)}>
              {t("cancel")}
            </Button>
          </Space>
        ) : (
          <Button size="small" disabled={editingKey !== null} onClick={() => startEdit(row)}>
            {t("edit")}
          </Button>
        ),
    },
  ];

  return (
    <div>
      {/* 区块 1：积分调整 */}
      <Card title={t("adjustTitle")} style={{ marginBottom: 16 }}>
        <Form
          form={adjustForm}
          layout="inline"
          onFinish={(values) => void handleAdjust(values as AdjustFormValues)}
          style={{ rowGap: 8 }}
        >
          <Form.Item name="userId" rules={[{ required: true }]}>
            <Select
              showSearch
              allowClear
              filterOption={false}
              onSearch={handleUserSearch}
              options={userOptions}
              placeholder={t("fieldUser")}
              style={{ width: 320 }}
              notFoundContent={t("userSearchEmpty")}
            />
          </Form.Item>
          <Form.Item name="delta" rules={[{ required: true }]}>
            <InputNumber
              precision={0}
              placeholder={t("fieldDelta")}
              style={{ width: 150 }}
              prefix="±"
            />
          </Form.Item>
          <Form.Item name="note" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder={t("fieldNote")} style={{ width: 220 }} allowClear maxLength={200} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={adjusting}>
              {t("adjust")}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 区块 2：流水查询 */}
      <Card title={t("ledgerTitle")} style={{ marginBottom: 16 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder={t("filterUser")}
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            onPressEnter={() => {
              setPage(1);
              setLoading(true);
              setLedgerTick((n) => n + 1);
            }}
            style={{ width: 260 }}
            allowClear
          />
          <Select<LedgerType>
            placeholder={t("filterType")}
            value={filterType}
            onChange={(v) => setFilterType(v)}
            allowClear
            style={{ width: 140 }}
            options={(Object.keys(TYPE_TAG) as LedgerType[]).map((k) => ({
              value: k,
              label: t(TYPE_TAG[k].key),
            }))}
          />
          <DatePicker.RangePicker
            value={range}
            onChange={(v) => setRange(v)}
            style={{ width: 260 }}
          />
          <Button
            type="primary"
            onClick={() => {
              setPage(1);
              setLoading(true);
              setLedgerTick((n) => n + 1);
            }}
          >
            {t("query")}
          </Button>
          <Button onClick={resetFilters}>{t("reset")}</Button>
        </Space>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
        <Table<LedgerRow>
          rowKey="id"
          loading={loading}
          columns={ledgerColumns}
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
      </Card>

      {/* 区块 3：余额对账 */}
      <Card title={t("reconcileTitle")} style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary">{t("reconcileHint")}</Typography.Paragraph>
        <Button type="primary" loading={reconciling} onClick={() => void runReconcile()}>
          {t("reconcileRun")}
        </Button>
        {reconcileResult && (
          <div style={{ marginTop: 16 }}>
            {reconcileResult.consistent ? (
              <Alert type="success" message={t("reconcileAllGood")} showIcon />
            ) : (
              <>
                <Alert
                  type="warning"
                  message={t("reconcileMismatch", { count: reconcileResult.total })}
                  showIcon
                  style={{ marginBottom: 16 }}
                />
                <Table
                  rowKey="userId"
                  columns={reconcileColumns}
                  dataSource={reconcileResult.mismatches}
                  pagination={false}
                  size="small"
                />
              </>
            )}
          </div>
        )}
      </Card>

      {/* 区块 4：任务定价 */}
      <Card title={t("pricingTitle")}>
        <Table<PriceRow>
          rowKey="key"
          loading={pricesLoading}
          columns={priceColumns}
          dataSource={prices}
          pagination={false}
          size="small"
        />
      </Card>
    </div>
  );
}
