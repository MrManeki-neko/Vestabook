"use client";

import { useEffect, useState } from "react";

export const DONGLE_STORAGE_KEY = "vestabook_dongle";

export function getStoredDongle(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(DONGLE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredDongle(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(DONGLE_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(DONGLE_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures (private browsing, quota, etc.)
  }
}

interface SettingsSheetProps {
  open: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSave: (secret: string) => void;
}

export default function SettingsSheet({ open, errorMessage, onClose, onSave }: SettingsSheetProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) {
      setValue(getStoredDongle());
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="settings-sheet-title">Remote control secret</h2>
        <label htmlFor="dongle-input">
          Dongle secret
          <input
            id="dongle-input"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter secret"
          />
        </label>
        {errorMessage && <p className="sheet-error">{errorMessage}</p>}
        <div className="sheet-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStoredDongle(value.trim());
              onSave(value.trim());
            }}
          >
            Save
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
