"use client";

// 管理总览看板（task 7.2）：任务事实统计（默认 24h 窗）+ 最近失败列表。
// 纯只读：仅 GET /api/admin/dashboard/tasks，无任何写路由。
import { useCallback, useEffect, useState } from "react";
import { Alert, Card, Col, Row, Space, Spin, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

interface FailureRow {
  key: string;
  id: string;
  type: string;
  error: string | null;
  sessionId: string | null;
  createdAt: string;
}

interface DashboardPayload {
  statusCounts: Record<"pending" | "running" | "succeeded" | "failed" | "canceled", number>;
  window: {
    startedAt: string;
    terminalCount: number;
    failedCount: number;
    failureRate: number | null;
    avgDurationMs: number | null;
  };
  recentFailures: Array<{
    id: string;
    type: string;
    status: string;
    error: string | null;
    sessionId: string | null;
    createdAt: string;
  }>;
}

const STATUS_ORDER = ["pending", "running", "succeeded", "failed", "canceled"] as const;

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1_000)}s`;
}

export default function DashboardView() {
  const t = useTranslations("common.section.home");

  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/dashboard/tasks")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as DashboardPayload;
      })
      .then((payload) => {
        if (!active) return;
        setData(payload);
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
  }, [t]);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/dashboard/tasks")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as DashboardPayload;
      })
      .then((payload) => {
        setData(payload);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        setError(t("loadFailed"));
        setLoading(false);
      });
  }, [t]);

  const columns: ColumnsType<FailureRow> = [
    {
      title: t("columnTaskId"),
      dataIndex: "id",
      width: 300,
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t("columnType"),
      dataIndex: "type",
      width: 160,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: t("columnError"),
      dataIndex: "error",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: t("columnUpdatedAt"),
      dataIndex: "createdAt",
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
  ];

  const rows: FailureRow[] = (data?.recentFailures ?? []).map((f) => ({
    key: f.id,
    id: f.id,
    type: f.type,
    error: f.error,
    sessionId: f.sessionId,
    createdAt: f.createdAt,
  }));

  const rate = data?.window.failureRate;
  const avg = data?.window.avgDurationMs;

  return (
    <Spin spinning={loading}>
      {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}
      <Row gutter={[16, 16]}>
        {STATUS_ORDER.map((status) => (
          <Col key={status} xs={12} md={8} lg={4}>
            <Card size="small">
              <Statistic
                title={t(`status_${status}`)}
                value={data?.statusCounts[status] ?? 0}
                styles={{ content: status === "failed" ? { color: "#cf1322" } : undefined }}
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Card size="small" title={t("windowTitle")} style={{ margin: "16px 0" }}>
        <Space size={48} wrap>
          <Statistic
            title={t("failureRate")}
            value={rate === null || rate === undefined ? "—" : (rate * 100).toFixed(1)}
            suffix={rate === null || rate === undefined ? "" : "%"}
            styles={{ content: rate !== null && rate !== undefined && rate > 0.2 ? { color: "#cf1322" } : undefined }}
          />
          <Statistic
            title={t("avgDuration")}
            value={avg === null || avg === undefined ? "—" : formatDuration(avg)}
          />
          <Statistic title={t("terminalCount")} value={data?.window.terminalCount ?? 0} />
          <Typography.Text type="secondary">
            {t("windowSince")}：{data ? new Date(data.window.startedAt).toLocaleString() : "—"}
          </Typography.Text>
        </Space>
      </Card>
      <Card
        size="small"
        title={t("recentFailuresTitle")}
        extra={
          <a onClick={refresh} role="button" tabIndex={0}>
            {t("refresh")}
          </a>
        }
      >
        <Table<FailureRow>
          rowKey="key"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={false}
          locale={{ emptyText: t("noFailures") }}
        />
      </Card>
    </Spin>
  );
}
