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

/**
 * Live catalog of the component library with the current theme. Shown under
 * Settings -> Apariencia, where it doubles as the preview of the colors being
 * edited. Everything here is rendered by the real components, nothing mocked.
 */
export function Catalog() {
  const [tab, setTab] = useState("kickoff");
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="ygg-catalog">
      <h4 className="ygg-catalog__title">Vista previa</h4>

      <div>
        <div className="ygg-catalog__label">Botones</div>
        <div className="ygg-catalog__row">
          <Button variant="primary">Principal</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Discreto</Button>
          <Button variant="danger">Peligroso</Button>
          <Button variant="secondary" size="sm">
            Pequeño
          </Button>
          <Button variant="primary" disabled>
            Deshabilitado
          </Button>
          <IconButton label="Ajustes">⚙</IconButton>
        </div>
      </div>

      <div>
        <div className="ygg-catalog__label">Estados</div>
        <div className="ygg-catalog__row">
          <StatusChip status="working" dot />
          <StatusChip status="checking" />
          <StatusChip status="ready" />
          <StatusChip status="needs-decision" />
          <Chip tone="accent">Acento</Chip>
          <Chip>Neutro</Chip>
        </div>
      </div>

      <div>
        <div className="ygg-catalog__label">Progreso</div>
        <div className="ygg-catalog__row">
          <div style={{ width: 220 }}>
            <ProgressBar value={0.89} label="Avance de la feature" />
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
        <div className="ygg-catalog__label">Pestañas y navegación</div>
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
        <div className="ygg-catalog__label">Campos</div>
        <div className="ygg-catalog__row">
          <div style={{ width: 220 }}>
            <Field label="Nombre">
              <Input placeholder="template-fight" />
            </Field>
          </div>
          <div style={{ width: 180 }}>
            <Field label="Modelo">
              <Select defaultValue="sonnet">
                <option value="sonnet">Sonnet 5.5</option>
                <option value="opus">Opus 5.5</option>
              </Select>
            </Field>
          </div>
        </div>
      </div>

      <div>
        <div className="ygg-catalog__label">Tarjeta, menú y diálogo</div>
        <div className="ygg-catalog__row" style={{ alignItems: "flex-start" }}>
          <Card accent>
            <strong>template-fight</strong>
            <span style={{ color: "var(--ygg-text-muted)", fontSize: 12 }}>D:\games\template-fight</span>
          </Card>
          <div className="ygg-catalog__menu">
            <div className="ygg-menu">
              <button type="button" className="ygg-menu__item">
                Renombrar
              </button>
              <button type="button" className="ygg-menu__item">
                Copiar ruta
              </button>
              <div className="ygg-menu__separator" />
              <button type="button" className="ygg-menu__item ygg-menu__item--danger">
                Eliminar
              </button>
            </div>
          </div>
          <Button onClick={() => setModalOpen(true)}>Abrir diálogo</Button>
        </div>
      </div>

      {modalOpen && (
        <Modal
          title="Diálogo de ejemplo"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>
                Aceptar
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, color: "var(--ygg-text-2)" }}>Así se ve un diálogo con el tema actual.</p>
        </Modal>
      )}
    </div>
  );
}
