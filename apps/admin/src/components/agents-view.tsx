"use client";

// Agent 开关视图（task 6.2）：清单表格 + 启停 Switch（Popconfirm 确认）+ 来源层标注。
// 纪律同 users-view：开关以服务端返回为准（preventDefault 阻止乐观翻转）；
// 30s TTL 跨进程生效窗口在来源列以 Tag 呈现（overlay 即本端已生效）。
import { useCallback, useEffect, useState } from "react";
import { Alert, Popconfirm, Switch, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

interface AgentRow {
  id: string;
  name: string;
  enabled: boolean;
  source: "overlay" | "env" | "catalog";
}

export default function AgentsView() {
  const t = useTranslations("common.section.agents");

  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchAgents = useCallback(async (): Promise<AgentRow[]> => {
    const res = await fetch("/api/admin/agents");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { agents: AgentRow[] }).agents;
  }, []);

  useEffect(() => {
    let active = true;
    fetchAgents()
      .then((agents) => {
        if (!active) return;
        setRows(agents);
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
  }, [fetchAgents, t]);

  const applyEnabled = async (row: AgentRow, enabled: boolean) => {
    setSavingId(row.id);
    try {
      const res = await fetch(`/api/admin/agents/${row.id}/enabled`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const { agent } = (await res.json()) as { agent: AgentRow };
        setRows((prev) => prev.map((r) => (r.id === row.id ? agent : r)));
        message.success(t("toggleDone"));
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      message.error(
        body?.error?.code === "AGENT_UNKNOWN" ? t("agentUnknown") : t("toggleFailed"),
      );
    } catch {
      message.error(t("toggleFailed"));
    } finally {
      setSavingId(null);
    }
  };

  const columns: ColumnsType<AgentRow> = [
    { title: t("columnName"), dataIndex: "name", width: 180 },
    {
      title: t("columnId"),
      dataIndex: "id",
      width: 220,
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t("columnEnabled"),
      dataIndex: "enabled",
      width: 100,
      render: (v: boolean) => (v ? t("enabledOn") : t("enabledOff")),
    },
    {
      title: t("columnSource"),
      dataIndex: "source",
      width: 140,
      render: (v: AgentRow["source"]) => (
        <Tag color={v === "overlay" ? "blue" : v === "env" ? "gold" : "default"}>
          {v === "overlay" ? t("sourceOverlay") : v === "env" ? t("sourceEnv") : t("sourceCatalog")}
        </Tag>
      ),
    },
    {
      title: t("columnAction"),
      key: "action",
      width: 100,
      render: (_, row) => {
        const disabling = row.enabled;
        return (
          <Popconfirm
            title={disabling ? t("confirmDisable") : t("confirmEnable")}
            description={t("effectiveHint")}
            okText={t("confirmOk")}
            cancelText={t("confirmCancel")}
            onConfirm={() => void applyEnabled(row, disabling ? false : true)}
          >
            {/* 状态以确认后服务端返回为准（antd 确认开关模式） */}
            <Switch
              size="small"
              checked={row.enabled}
              disabled={savingId === row.id}
              onClick={(_checked, e) => e.preventDefault()}
            />
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <Table<AgentRow> rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={false} />
    </div>
  );
}
