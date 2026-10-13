"use client";

// 模型配置视图（task 6.3）：目录条目启停（文本/图像两组）+ 角色默认三层明细与设置/清除。
// 状态一律以 GET /api/admin/models 全量回读为准（写后 refresh），避免乐观态漂移。
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Popconfirm, Select, Space, Switch, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

interface ModelRow {
  key: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  capabilities: readonly string[];
  defaultModelId?: string;
  enabled: boolean;
  source: "overlay" | "env" | "catalog";
}

interface RoleLayers {
  effective: { providerId: string; modelId: string; source: "overlay" | "env" | "catalog" };
  overlay: { providerId: string; modelId: string } | null;
  env: string | null;
  catalog: string;
}

interface ModelsPayload {
  textProviders: Array<{
    providerId: string;
    label: string;
    configEnvNames: readonly string[];
    models: Array<{ id: string; capabilities: readonly string[]; enabled: boolean; source: ModelRow["source"] }>;
  }>;
  imageProviders: Array<{
    providerId: string;
    label: string;
    configEnvNames: readonly string[];
    defaultModelId: string;
    models: Array<{ id: string; capabilities: readonly string[]; enabled: boolean; source: ModelRow["source"] }>;
  }>;
  roleDefaults: { main: RoleLayers; summarizer: RoleLayers };
}

const SOURCE_COLORS: Record<ModelRow["source"], string> = {
  overlay: "blue",
  env: "gold",
  catalog: "default",
};

function sourceLabel(t: (k: string) => string, v: ModelRow["source"]): string {
  return v === "overlay" ? t("sourceOverlay") : v === "env" ? t("sourceEnv") : t("sourceCatalog");
}

export default function ModelsView() {
  const t = useTranslations("common.section.models");

  const [data, setData] = useState<ModelsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<Record<string, { providerId: string; modelId: string }>>({});

  const fetchModels = useCallback(async (): Promise<ModelsPayload> => {
    const res = await fetch("/api/admin/models");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ModelsPayload;
  }, []);

  useEffect(() => {
    let active = true;
    fetchModels()
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
  }, [fetchModels, t]);

  const refresh = useCallback(async () => {
    try {
      setData(await fetchModels());
      setError(null);
    } catch {
      setError(t("loadFailed"));
    }
  }, [fetchModels, t]);

  const toggleModel = async (providerId: string, modelId: string, enabled: boolean) => {
    setSavingKey(`${providerId}/${modelId}`);
    try {
      const res = await fetch(`/api/admin/models/${providerId}/${modelId}/enabled`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        message.success(t("toggleDone"));
        await refresh();
        return;
      }
      message.error(t("toggleFailed"));
    } catch {
      message.error(t("toggleFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const setRoleDefault = async (role: string) => {
    const draft = roleDraft[role];
    if (!draft) return;
    setSavingKey(`role:${role}`);
    try {
      const res = await fetch(`/api/admin/models/role-defaults/${role}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (res.ok) {
        message.success(t("roleSetDone"));
        setRoleDraft((prev) => {
          const next = { ...prev };
          delete next[role];
          return next;
        });
        await refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      message.error(body?.error?.code === "MODEL_UNKNOWN" ? t("modelUnknown") : t("roleSetFailed"));
    } catch {
      message.error(t("roleSetFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const clearRoleDefault = async (role: string) => {
    setSavingKey(`role:${role}`);
    try {
      const res = await fetch(`/api/admin/models/role-defaults/${role}`, { method: "DELETE" });
      if (res.ok) {
        message.success(t("roleClearedDone"));
        await refresh();
        return;
      }
      message.error(t("roleSetFailed"));
    } catch {
      message.error(t("roleSetFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const toRows = (providers: ModelsPayload["textProviders"], withDefault: boolean): ModelRow[] =>
    providers.flatMap((p) =>
      p.models.map((m) => ({
        key: `${p.providerId}/${m.id}`,
        providerId: p.providerId,
        providerLabel: p.label,
        modelId: m.id,
        capabilities: m.capabilities,
        ...(withDefault && "defaultModelId" in p
          ? { defaultModelId: (p as { defaultModelId: string }).defaultModelId }
          : {}),
        enabled: m.enabled,
        source: m.source,
      })),
    );

  const columns: ColumnsType<ModelRow> = [
    { title: t("columnProvider"), dataIndex: "providerLabel", width: 190 },
    {
      title: t("columnModel"),
      dataIndex: "modelId",
      width: 210,
      render: (v: string, row) => (
        <Space size={6}>
          <code>{v}</code>
          {row.defaultModelId === row.modelId && <Tag>{t("defaultModel")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("columnCapabilities"),
      dataIndex: "capabilities",
      width: 110,
      render: (v: readonly string[]) => (v.includes("vision") ? <Tag color="purple">{t("capVision")}</Tag> : "—"),
    },
    {
      title: t("columnEnabled"),
      dataIndex: "enabled",
      width: 90,
      render: (v: boolean) => (v ? t("enabledOn") : t("enabledOff")),
    },
    {
      title: t("columnSource"),
      dataIndex: "source",
      width: 130,
      render: (v: ModelRow["source"]) => <Tag color={SOURCE_COLORS[v]}>{sourceLabel(t, v)}</Tag>,
    },
    {
      title: t("columnAction"),
      key: "action",
      width: 90,
      render: (_, row) => (
        <Popconfirm
          title={row.enabled ? t("confirmDisable") : t("confirmEnable")}
          okText={t("confirmOk")}
          cancelText={t("confirmCancel")}
          onConfirm={() => void toggleModel(row.providerId, row.modelId, row.enabled ? false : true)}
        >
          {/* 状态以确认后服务端回读为准（antd 确认开关模式） */}
          <Switch
            size="small"
            checked={row.enabled}
            disabled={savingKey === row.key}
            onClick={(_c, e) => e.preventDefault()}
          />
        </Popconfirm>
      ),
    },
  ];

  const textOptions = (data?.textProviders ?? []).map((p) => ({
    label: p.label,
    options: p.models.map((m) => ({
      label: m.id,
      value: `${p.providerId}/${m.id}`,
      disabled: !m.enabled,
    })),
  }));

  const renderRoleCard = (role: "main" | "summarizer") => {
    const layers = data?.roleDefaults[role];
    if (!layers) return null;
    const draft = roleDraft[role];
    return (
      <Card
        size="small"
        title={role === "main" ? t("roleMain") : t("roleSummarizer")}
        extra={
          <Space>
            <Select
              style={{ width: 260 }}
              placeholder={t("rolePickPlaceholder")}
              value={draft ? `${draft.providerId}/${draft.modelId}` : undefined}
              options={textOptions}
              onChange={(v: string) => {
                const [providerId, modelId] = v.split("/");
                setRoleDraft((prev) => ({ ...prev, [role]: { providerId, modelId } }));
              }}
            />
            <Button
              type="primary"
              size="small"
              disabled={!draft}
              loading={savingKey === `role:${role}`}
              onClick={() => void setRoleDefault(role)}
            >
              {t("roleSet")}
            </Button>
            {layers.overlay && (
              <Popconfirm
                title={t("confirmClear")}
                okText={t("confirmOk")}
                cancelText={t("confirmCancel")}
                onConfirm={() => void clearRoleDefault(role)}
              >
                <Button size="small" loading={savingKey === `role:${role}`}>
                  {t("roleClear")}
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Space size={24} wrap>
          <span>
            {t("effectiveNow")}:{" "}
            <code>
              {layers.effective.providerId}/{layers.effective.modelId}
            </code>{" "}
            <Tag color={SOURCE_COLORS[layers.effective.source]}>{sourceLabel(t, layers.effective.source)}</Tag>
          </span>
          <span>
            {t("layerOverlay")}: {layers.overlay ? <code>{layers.overlay.modelId}</code> : "—"}
          </span>
          <span>
            {t("layerEnv")}: {layers.env ? <code>{layers.env}</code> : "—"}
          </span>
          <span>
            {t("layerCatalog")}: <code>{layers.catalog}</code>
          </span>
        </Space>
      </Card>
    );
  };

  return (
    <div>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <Card size="small" title={t("roleDefaultsTitle")} style={{ marginBottom: 24 }}>
        <Space orientation="vertical" style={{ width: "100%" }}>
          {renderRoleCard("main")}
          {renderRoleCard("summarizer")}
        </Space>
      </Card>
      <Card size="small" title={t("textModelsTitle")} style={{ marginBottom: 24 }}>
        <Table<ModelRow>
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={data ? toRows(data.textProviders, false) : []}
          pagination={false}
        />
      </Card>
      <Card size="small" title={t("imageModelsTitle")}>
        <Table<ModelRow>
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={data ? toRows(data.imageProviders, true) : []}
          pagination={false}
        />
      </Card>
    </div>
  );
}
