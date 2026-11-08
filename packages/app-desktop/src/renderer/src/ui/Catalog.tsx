import { useState } from "react";
import { Button } from "./Button.js";
import { Card } from "./Card.js";
import { Chip } from "./Chip.js";
import { Field, Input, Select } from "./Field.js";
import { IconButton } from "./IconButton.js";
import { Modal } from "./Modal.js";
import { NavItem } from "./NavItem.js";
import { ProgressBar } from "./ProgressBar.js";
import { StatusChip } from "./Chip.js";
import { Tabs } from "./Tabs.js";
import { useI18n } from "../i18n/index.js";

/**
 * Live catalog of the component library with the current theme. Shown under
 * Settings -> Apariencia, where it doubles as the preview of the colors being
 * edited. Everything here is rendered by the real components, nothing mocked.
 */
export function Catalog() {
  const { t } = useI18n();
  const [tab, setTab] = useState("kickoff");
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="ygg-catalog">
      <h4 className="ygg-catalog__title">{t("ui.cat.preview")}</h4>

      <div>
        <div className="ygg-catalog__label">{t("ui.cat.buttons")}</div>
        <div className="ygg-catalog__row">
          <Button variant="primary">{t("ui.cat.primary")}</Button>
          <Button variant="secondary">{t("ui.cat.secondary")}</Button>
          <Button variant="ghost">{t("ui.cat.ghost")}</Button>
          <Button variant="danger">{t("ui.cat.danger")}</Button>
          <Button variant="secondary" size="sm">
            {t("ui.cat.small")}
          </Button>
          <Button variant="primary" disabled>
            {t("ui.cat.disabled")}
          </Button>
          <IconButton label={t("ui.cat.settings")}>⚙</IconButton>
        </div>
      </div>

      <div>
        <div className="ygg-catalog__label">{t("ui.cat.states")}</div>
        <div className="ygg-catalog__row">
          <StatusChip status="working" dot />
          <StatusChip status="checking" />
          <StatusChip status="ready" />
          <StatusChip status="needs-decision" />
          <Chip tone="accent">{t("ui.cat.accent")}</Chip>
          <Chip>{t("ui.cat.neutral")}</Chip>
        </div>
      </div>

      <div>
        <div className="ygg-catalog__label">{t("ui.cat.progress")}</div>
        <div className="ygg-catalog__row">
          <div style={{ width: 220 }}>
            <ProgressBar value={0.89} label={t("ui.cat.featureProgress")} />
          </div>
          <div style={{ width: 120 }}>
            <ProgressBar value={0.5} tone="working" />
          </div>
          <div style={{ width: 120 }}>
            <ProgressBar value={1} tone="ready" />
          </div>
        </div>
      </div>

      <div>
        <div className="ygg-catalog__label">{t("ui.cat.tabsNav")}</div>
        <Tabs
          tabs={[
            { id: "kickoff", label: "fight-template-kickoff.md", closable: true },
            { id: "combat", label: "combat-spec.md", closable: true },
            { id: "ui", label: "ui-spec.md" },
          ]}
          active={tab}
          onSelect={setTab}
        />
        <div className="ygg-catalog__row" style={{ marginTop: 10 }}>
          <div style={{ width: 200 }}>
            <NavItem active>Terminal</NavItem>
            <NavItem>Agent Flow</NavItem>
          </div>
        </div>
      </div>

      <div>
        <div className="ygg-catalog__label">{t("ui.cat.fields")}</div>
        <div className="ygg-catalog__row">
          <div style={{ width: 220 }}>
            <Field label={t("ui.cat.name")}>
              <Input placeholder="template-fight" />
            </Field>
          </div>
          <div style={{ width: 180 }}>
            <Field label={t("ui.cat.model")}>
              <Select defaultValue="sonnet">
                <option value="sonnet">Sonnet 5.5</option>
                <option value="opus">Opus 5.5</option>
              </Select>
            </Field>
          </div>
        </div>
      </div>

      <div>
        <div className="ygg-catalog__label">{t("ui.cat.cardMenuDialog")}</div>
        <div className="ygg-catalog__row" style={{ alignItems: "flex-start" }}>
          <Card accent>
            <strong>template-fight</strong>
            <span style={{ color: "var(--ygg-text-muted)", fontSize: 12 }}>D:\games\template-fight</span>
          </Card>
          <div className="ygg-catalog__menu">
            <div className="ygg-menu">
              <button type="button" className="ygg-menu__item">
                {t("ui.cat.rename")}
              </button>
              <button type="button" className="ygg-menu__item">
                {t("ui.cat.copyPath")}
              </button>
              <div className="ygg-menu__separator" />
              <button type="button" className="ygg-menu__item ygg-menu__item--danger">
                {t("ui.cat.delete")}
              </button>
            </div>
          </div>
          <Button onClick={() => setModalOpen(true)}>{t("ui.cat.openDialog")}</Button>
        </div>
      </div>

      {modalOpen && (
        <Modal
          title={t("ui.cat.dialogTitle")}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                {t("ui.cancel")}
              </Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>
                {t("ui.cat.accept")}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, color: "var(--ygg-text-2)" }}>{t("ui.cat.dialogBody")}</p>
        </Modal>
      )}
    </div>
  );
}
