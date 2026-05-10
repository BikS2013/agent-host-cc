/**
 * ProfileEditor — list + create/edit/delete UI for profiles.
 *
 * Renders against `profiles.value` (redacted profiles from the server). The
 * form fields adapt to the selected `backendKind` per project-design §14.4:
 *
 *   - agent-host-cc:  baseUrl, apiKey, defaultModel
 *   - openai:         baseUrl (optional), apiKey, defaultModel
 *   - azure-openai:   endpoint, deployment, apiVersion, apiKey  (no defaultModel)
 *
 * Common optional fields (systemPrompt, temperature, maxTokens) are rendered
 * inside an "Advanced" details block per FU-9 / §14.4.
 *
 * PUT-with-redacted semantics (§14.6.3 / §14.12): when editing, an empty apiKey
 * field is sent to the server as the literal sentinel "<redacted>" so the
 * existing on-disk key is preserved.
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import {
  profiles,
  createProfile,
  updateProfile,
  deleteProfile,
} from "../state";

type BackendKind = "agent-host-cc" | "openai" | "azure-openai";

interface FormState {
  // Common
  name: string;
  backendKind: BackendKind;
  systemPrompt: string;
  temperature: string; // string-bound for the input; parsed on submit
  maxTokens: string; // string-bound for the input; parsed on submit
  apiKey: string;

  // agent-host-cc + openai
  baseUrl: string;
  defaultModel: string;

  // azure-openai
  endpoint: string;
  deployment: string;
  apiVersion: string;
}

const REDACTED_SENTINEL = "<redacted>";

function emptyForm(kind: BackendKind = "agent-host-cc"): FormState {
  return {
    name: "",
    backendKind: kind,
    systemPrompt: "",
    temperature: "",
    maxTokens: "",
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
    endpoint: "",
    deployment: "",
    apiVersion: "",
  };
}

function profileToForm(p: any): FormState {
  // We receive a redacted profile (apiKey === "<redacted>"). Pre-fill the form
  // with everything except the key — leave the key field blank so the user can
  // either type a new key or leave it blank to preserve the existing one.
  const form = emptyForm(p.backendKind as BackendKind);
  form.name = p.name ?? "";
  form.systemPrompt = p.systemPrompt ?? "";
  form.temperature =
    typeof p.temperature === "number" ? String(p.temperature) : "";
  form.maxTokens =
    typeof p.maxTokens === "number" ? String(p.maxTokens) : "";
  form.apiKey = ""; // intentionally blank; submit logic re-injects sentinel.

  if (p.backendKind === "agent-host-cc" || p.backendKind === "openai") {
    form.baseUrl = p.baseUrl ?? "";
    form.defaultModel = p.defaultModel ?? "";
  } else if (p.backendKind === "azure-openai") {
    form.endpoint = p.endpoint ?? "";
    form.deployment = p.deployment ?? "";
    form.apiVersion = p.apiVersion ?? "";
  }
  return form;
}

function buildPayload(form: FormState, isEdit: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    backendKind: form.backendKind,
  };

  // apiKey: on edit, blank means "preserve" — send the redacted sentinel.
  if (form.apiKey.trim() === "") {
    if (isEdit) {
      payload.apiKey = REDACTED_SENTINEL;
    }
    // On create, omit; the server will reject (apiKey is required) and the
    // surfaced 422 will name the missing field per §14.10.
  } else {
    payload.apiKey = form.apiKey;
  }

  // Branch per backendKind.
  if (form.backendKind === "agent-host-cc") {
    if (form.baseUrl.trim() !== "") payload.baseUrl = form.baseUrl.trim();
    if (form.defaultModel.trim() !== "")
      payload.defaultModel = form.defaultModel.trim();
  } else if (form.backendKind === "openai") {
    // baseUrl is optional for openai; only forward if user typed something.
    if (form.baseUrl.trim() !== "") payload.baseUrl = form.baseUrl.trim();
    if (form.defaultModel.trim() !== "")
      payload.defaultModel = form.defaultModel.trim();
  } else if (form.backendKind === "azure-openai") {
    if (form.endpoint.trim() !== "") payload.endpoint = form.endpoint.trim();
    if (form.deployment.trim() !== "")
      payload.deployment = form.deployment.trim();
    if (form.apiVersion.trim() !== "")
      payload.apiVersion = form.apiVersion.trim();
  }

  // Common optional fields.
  if (form.systemPrompt.trim() !== "")
    payload.systemPrompt = form.systemPrompt;
  if (form.temperature.trim() !== "") {
    const n = Number(form.temperature);
    if (Number.isFinite(n)) payload.temperature = n;
  }
  if (form.maxTokens.trim() !== "") {
    const n = Number(form.maxTokens);
    if (Number.isFinite(n)) payload.maxTokens = n;
  }

  return payload;
}

interface Props {
  onClose: () => void;
}

export function ProfileEditor({ onClose }: Props) {
  const list = profiles.value;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const startEdit = (id: string) => {
    const target = list.find((p) => p.id === id);
    if (!target) return;
    setEditingId(id);
    setForm(profileToForm(target));
    setFormError(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete profile "${name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteProfile(id);
      if (editingId === id) {
        setEditingId(null);
        setForm(emptyForm());
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = buildPayload(form, editingId !== null);
      if (editingId !== null) {
        // UpdateProfileInput requires `id`; it must equal the URL param.
        const updatePayload = { ...payload, id: editingId };
        await updateProfile(editingId, updatePayload as any);
      } else {
        await createProfile(payload as any);
      }
      // Reset back to "create" mode after a successful save.
      setEditingId(null);
      setForm(emptyForm());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div class="profile-editor" role="dialog" aria-label="Manage profiles">
      <div class="profile-editor__header">
        <h2 class="profile-editor__title">Profiles</h2>
        <button
          type="button"
          class="profile-editor__close"
          onClick={onClose}
          aria-label="Close profile editor"
        >
          Close
        </button>
      </div>

      <div class="profile-editor__body">
        <section class="profile-editor__list">
          <div class="profile-editor__list-header">
            <h3>Existing</h3>
            <button type="button" onClick={startCreate}>
              + New profile
            </button>
          </div>
          {list.length === 0 && (
            <p class="profile-editor__empty">
              No profiles yet. Use the form to create one.
            </p>
          )}
          <ul>
            {list.map((p) => (
              <li key={p.id} class="profile-editor__item">
                <span class="profile-editor__item-name">{p.name}</span>
                <span class="profile-editor__item-kind">[{p.backendKind}]</span>
                <button type="button" onClick={() => startEdit(p.id)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(p.id, p.name)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section class="profile-form">
          <h3>{editingId !== null ? "Edit profile" : "New profile"}</h3>

          <form onSubmit={handleSubmit}>
            <div class="field">
              <label for="pf-name">Name</label>
              <input
                id="pf-name"
                type="text"
                value={form.name}
                onInput={(e) =>
                  setField("name", (e.currentTarget as HTMLInputElement).value)
                }
                required
              />
            </div>

            <fieldset class="field field--kind">
              <legend>Backend kind</legend>
              {(["agent-host-cc", "openai", "azure-openai"] as BackendKind[]).map(
                (k) => (
                  <label key={k} class="field__radio">
                    <input
                      type="radio"
                      name="backendKind"
                      value={k}
                      checked={form.backendKind === k}
                      onChange={() => setField("backendKind", k)}
                      disabled={editingId !== null}
                    />
                    <span>{k}</span>
                  </label>
                ),
              )}
              {editingId !== null && (
                <p class="field__hint">
                  Backend kind cannot be changed after a profile is created.
                </p>
              )}
            </fieldset>

            {form.backendKind === "agent-host-cc" && (
              <div class="profile-form__branch">
                <div class="field">
                  <label for="pf-baseurl-ahc">Base URL</label>
                  <input
                    id="pf-baseurl-ahc"
                    type="url"
                    placeholder="http://localhost:8000"
                    value={form.baseUrl}
                    onInput={(e) =>
                      setField(
                        "baseUrl",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                </div>
                <div class="field">
                  <label for="pf-apikey-ahc">Bearer token (apiKey)</label>
                  <input
                    id="pf-apikey-ahc"
                    type="password"
                    placeholder={
                      editingId !== null
                        ? "(leave blank to keep existing)"
                        : ""
                    }
                    value={form.apiKey}
                    onInput={(e) =>
                      setField(
                        "apiKey",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </div>
                <div class="field">
                  <label for="pf-model-ahc">Default model</label>
                  <input
                    id="pf-model-ahc"
                    type="text"
                    placeholder="cc.claude-sonnet-4-6"
                    value={form.defaultModel}
                    onInput={(e) =>
                      setField(
                        "defaultModel",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                  <p class="field__hint">
                    Include the server's MODEL_PREFIX (default <code>cc.</code>),
                    e.g. <code>cc.claude-sonnet-4-6</code>.
                  </p>
                </div>
              </div>
            )}

            {form.backendKind === "openai" && (
              <div class="profile-form__branch">
                <div class="field">
                  <label for="pf-baseurl-oa">Base URL (optional)</label>
                  <input
                    id="pf-baseurl-oa"
                    type="url"
                    placeholder="https://api.openai.com"
                    value={form.baseUrl}
                    onInput={(e) =>
                      setField(
                        "baseUrl",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </div>
                <div class="field">
                  <label for="pf-apikey-oa">API key</label>
                  <input
                    id="pf-apikey-oa"
                    type="password"
                    placeholder={
                      editingId !== null
                        ? "(leave blank to keep existing)"
                        : ""
                    }
                    value={form.apiKey}
                    onInput={(e) =>
                      setField(
                        "apiKey",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </div>
                <div class="field">
                  <label for="pf-model-oa">Default model</label>
                  <input
                    id="pf-model-oa"
                    type="text"
                    placeholder="gpt-4o-mini"
                    value={form.defaultModel}
                    onInput={(e) =>
                      setField(
                        "defaultModel",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                </div>
              </div>
            )}

            {form.backendKind === "azure-openai" && (
              <div class="profile-form__branch">
                <div class="field">
                  <label for="pf-endpoint-az">Endpoint</label>
                  <input
                    id="pf-endpoint-az"
                    type="url"
                    placeholder="https://my-resource.openai.azure.com"
                    value={form.endpoint}
                    onInput={(e) =>
                      setField(
                        "endpoint",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                </div>
                <div class="field">
                  <label for="pf-deployment-az">Deployment</label>
                  <input
                    id="pf-deployment-az"
                    type="text"
                    placeholder="gpt-4o-mini"
                    value={form.deployment}
                    onInput={(e) =>
                      setField(
                        "deployment",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                </div>
                <div class="field">
                  <label for="pf-apiversion-az">API version</label>
                  <input
                    id="pf-apiversion-az"
                    type="text"
                    placeholder="2024-10-21"
                    value={form.apiVersion}
                    onInput={(e) =>
                      setField(
                        "apiVersion",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                </div>
                <div class="field">
                  <label for="pf-apikey-az">API key</label>
                  <input
                    id="pf-apikey-az"
                    type="password"
                    placeholder={
                      editingId !== null
                        ? "(leave blank to keep existing)"
                        : ""
                    }
                    value={form.apiKey}
                    onInput={(e) =>
                      setField(
                        "apiKey",
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </div>
                <p class="field__hint">
                  Azure infers the model from the deployment name; no
                  <code> defaultModel</code> field is needed.
                </p>
              </div>
            )}

            <details class="profile-form__advanced">
              <summary>Advanced (optional)</summary>
              <div class="field">
                <label for="pf-sysprompt">System prompt</label>
                <textarea
                  id="pf-sysprompt"
                  rows={3}
                  value={form.systemPrompt}
                  onInput={(e) =>
                    setField(
                      "systemPrompt",
                      (e.currentTarget as HTMLTextAreaElement).value,
                    )
                  }
                />
              </div>
              <div class="field">
                <label for="pf-temp">Temperature (0..2)</label>
                <input
                  id="pf-temp"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={form.temperature}
                  onInput={(e) =>
                    setField(
                      "temperature",
                      (e.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </div>
              <div class="field">
                <label for="pf-maxtok">Max tokens</label>
                <input
                  id="pf-maxtok"
                  type="number"
                  step="1"
                  min="1"
                  value={form.maxTokens}
                  onInput={(e) =>
                    setField(
                      "maxTokens",
                      (e.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </div>
            </details>

            {formError !== null && (
              <div class="profile-form__error" role="alert">
                {formError}
              </div>
            )}

            <div class="profile-form__actions">
              <button type="submit" disabled={submitting}>
                {submitting
                  ? "Saving..."
                  : editingId !== null
                    ? "Save changes"
                    : "Create profile"}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={startCreate}
                  disabled={submitting}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
