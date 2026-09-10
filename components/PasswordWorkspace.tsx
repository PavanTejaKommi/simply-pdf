"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { downloadPdf } from "../lib/pdf";
import {
  encryptPdf,
  decryptPdf,
  checkPdfEncrypted,
  EncryptPdfOptions,
} from "../lib/pdf-security";

interface PasswordWorkspaceProps {
  initialMode?: "lock" | "unlock";
  defaultOpenPermissions?: boolean;
}

export function PasswordWorkspace({
  initialMode = "lock",
  defaultOpenPermissions = false,
}: PasswordWorkspaceProps) {
  const [mode, setMode] = useState<"lock" | "unlock">(initialMode);
  const [file, setFile] = useState<File | null>(null);
  const [isEncrypted, setIsEncrypted] = useState<boolean | null>(null);
  const [fileChecking, setFileChecking] = useState<boolean>(false);

  // Lock State
  const [userPassword, setUserPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [showUserPassword, setShowUserPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);

  const [useSeparateOwnerPassword, setUseSeparateOwnerPassword] =
    useState<boolean>(defaultOpenPermissions);
  const [ownerPassword, setOwnerPassword] = useState<string>("");
  const [showOwnerPassword, setShowOwnerPassword] = useState<boolean>(false);

  const [keyLength, setKeyLength] = useState<128 | 256>(256);

  // Permissions State
  const [printPerm, setPrintPerm] = useState<"full" | "low" | "none">("full");
  const [allowExtract, setAllowExtract] = useState<boolean>(true);
  const [modifyPerm, setModifyPerm] = useState<
    "all" | "annotate" | "form" | "assembly" | "none"
  >("all");
  const [allowAccessibility, setAllowAccessibility] = useState<boolean>(true);

  // Unlock State
  const [unlockPassword, setUnlockPassword] = useState<string>("");
  const [showUnlockPassword, setShowUnlockPassword] = useState<boolean>(false);

  // Processing & Feedback State
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Check encryption status whenever file changes
  useEffect(() => {
    if (!file) {
      setIsEncrypted(null);
      setMessage("");
      setError("");
      return;
    }

    let isMounted = true;
    setFileChecking(true);
    setError("");

    const checkFile = async () => {
      try {
        const buf = await file.arrayBuffer();
        const res = await checkPdfEncrypted(buf);
        if (!isMounted) return;
        setIsEncrypted(res.isEncrypted);

        // If file is already encrypted and user is on Lock tab, suggest Unlock
        if (res.isEncrypted && mode === "lock") {
          // keep mode or notify
        }
      } catch {
        if (!isMounted) return;
        setIsEncrypted(null);
      } finally {
        if (isMounted) setFileChecking(false);
      }
    };

    void checkFile();

    return () => {
      isMounted = false;
    };
  }, [file, mode]);

  // Evaluate Password Strength
  const evaluateStrength = (pass: string) => {
    if (!pass) return { score: 0, label: "None", color: "var(--muted)" };
    let score = 0;
    if (pass.length >= 6) score += 1;
    if (pass.length >= 10) score += 1;
    if (pass.length >= 14) score += 1;
    if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^a-zA-Z0-9]/.test(pass)) score += 1;

    if (score <= 2) return { score: 1, label: "Weak", color: "#ef4444" };
    if (score <= 3) return { score: 2, label: "Fair", color: "#f59e0b" };
    if (score <= 4) return { score: 3, label: "Good", color: "#3b82f6" };
    return { score: 4, label: "Strong", color: "#10b981" };
  };

  const strength = evaluateStrength(userPassword);
  const passwordsMatch = userPassword === confirmPassword;

  // Handle Lock PDF Execution
  const handleLockPdf = async () => {
    if (!file) return;

    if (!userPassword && !ownerPassword) {
      setError("Please enter a password to protect the document.");
      return;
    }

    if (userPassword && userPassword !== confirmPassword) {
      setError("The passwords do not match. Please verify and try again.");
      return;
    }

    setBusy(true);
    setMessage("");
    setError("");

    try {
      const buffer = await file.arrayBuffer();
      const options: EncryptPdfOptions = {
        input: buffer,
        userPassword: userPassword || undefined,
        ownerPassword: useSeparateOwnerPassword ? ownerPassword || userPassword : userPassword,
        keyLength,
        print: printPerm,
        modify: modifyPerm,
        extract: allowExtract,
        accessibility: allowAccessibility,
      };

      const encryptedBytes = await encryptPdf(options);
      const baseName = file.name.replace(/\.pdf$/i, "");
      downloadPdf(encryptedBytes, `${baseName}-protected.pdf`);

      setMessage(
        "Success! Your PDF has been encrypted and locked. The protected document was downloaded directly to your computer."
      );
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message ||
          "Failed to encrypt the PDF. Check that the file is not corrupted or already encrypted."
      );
    } finally {
      setBusy(false);
    }
  };

  // Handle Unlock PDF Execution
  const handleUnlockPdf = async () => {
    if (!file) return;

    setBusy(true);
    setMessage("");
    setError("");

    try {
      const buffer = await file.arrayBuffer();
      const decryptedBytes = await decryptPdf({
        input: buffer,
        password: unlockPassword,
      });

      const baseName = file.name.replace(/\.pdf$/i, "");
      downloadPdf(decryptedBytes, `${baseName}-unlocked.pdf`);

      setMessage(
        "Success! All password protection and document restrictions have been permanently removed. Your unlocked file has been downloaded."
      );
    } catch (err: any) {
      console.error(err);
      const errMsg = String(err?.message || "").toLowerCase();
      if (errMsg.includes("incorrect") || errMsg.includes("invalid password") || errMsg.includes("password")) {
        setError("Incorrect password. Please check the password and try again.");
      } else {
        setError("Could not unlock document. Please verify the password and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="workspace">
        <header className="topbar">
          <span className="local-pill">
            <span className="status-dot" /> 100% local processing
          </span>
          <div className="topbar-right">
            <span className="topbar-help">No uploads. No tracking.</span>
            <ThemeToggle />
          </div>
        </header>

        <section className="content">
          <div className="intro">
            <p className="eyebrow">PDF Security &amp; Protection</p>
            <h1>PDF Lock &amp; Unlock Studio</h1>
            <p className="description">
              Secure confidential documents with 256-bit AES encryption and custom permissions,
              or permanently remove passwords and restriction locks. 100% client-side privacy.
            </p>
          </div>

          <div className="password-studio-container">
            {/* Mode Tabs */}
            <div className="pwd-tabs-nav" role="tablist">
              <button
                type="button"
                className={`pwd-tab-btn ${mode === "lock" ? "active" : ""}`}
                onClick={() => {
                  setMode("lock");
                  setMessage("");
                  setError("");
                }}
              >
                <span className="tab-icon">🔒</span> Lock &amp; Protect PDF
              </button>
              <button
                type="button"
                className={`pwd-tab-btn ${mode === "unlock" ? "active" : ""}`}
                onClick={() => {
                  setMode("unlock");
                  setMessage("");
                  setError("");
                }}
              >
                <span className="tab-icon">🔓</span> Unlock &amp; Decrypt PDF
              </button>
            </div>

            {/* Upload Zone */}
            {!file ? (
              <label
                className="upload-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f && f.type.includes("pdf")) setFile(f);
                }}
              >
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setFile(f);
                  }}
                />
                <span className="upload-icon">{mode === "lock" ? "🔒" : "🔓"}</span>
                <strong>
                  {mode === "lock" ? "Drop PDF to lock &amp; protect" : "Drop locked PDF to unlock"}
                </strong>
                <span className="upload-hint">or click to browse · processed locally</span>
              </label>
            ) : (
              <div className="pwd-workspace-card">
                {/* File Details Bar */}
                <div className="pwd-file-banner">
                  <div className="file-info-group">
                    <span className={`file-type-badge ${isEncrypted ? "badge-locked" : "badge-pdf"}`}>
                      {isEncrypted ? "🔒 LOCKED" : "PDF"}
                    </span>
                    <div>
                      <strong>{file.name}</strong>
                      <span className="file-subtext">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                        {fileChecking
                          ? " · Checking security status…"
                          : isEncrypted === true
                          ? " · Password-protected"
                          : isEncrypted === false
                          ? " · Unprotected document"
                          : ""}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="reset-button"
                    onClick={() => {
                      setFile(null);
                      setUserPassword("");
                      setConfirmPassword("");
                      setOwnerPassword("");
                      setUnlockPassword("");
                      setMessage("");
                      setError("");
                    }}
                  >
                    Choose another file
                  </button>
                </div>

                {/* LOCK MODE FORM */}
                {mode === "lock" ? (
                  <div className="pwd-form-body">
                    {isEncrypted && (
                      <div className="pwd-notice-banner warning">
                        <span className="notice-icon">⚠️</span>
                        <div>
                          <strong>This document is already password-protected</strong>
                          <p>
                            To modify permissions or re-encrypt, switch to the <strong>Unlock PDF</strong> tab
                            first, or verify you have the current owner password.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="pwd-section">
                      <h3>1. Set Document Password</h3>
                      <p className="pwd-section-desc">
                        Required for users to open and view the PDF.
                      </p>

                      <div className="pwd-grid-2">
                        {/* Open Password */}
                        <div className="pwd-field-group">
                          <label className="pwd-label" htmlFor="user-pwd-input">
                            Document Open Password
                          </label>
                          <div className="pwd-input-wrap">
                            <input
                              id="user-pwd-input"
                              type={showUserPassword ? "text" : "password"}
                              className="pwd-text-input"
                              placeholder="Enter open password"
                              value={userPassword}
                              onChange={(e) => setUserPassword(e.target.value)}
                            />
                            <button
                              type="button"
                              className="pwd-eye-btn"
                              onClick={() => setShowUserPassword(!showUserPassword)}
                              aria-label={showUserPassword ? "Hide password" : "Show password"}
                            >
                              {showUserPassword ? "👁️‍🗨️" : "👁️"}
                            </button>
                          </div>

                          {/* Password Strength Meter */}
                          {userPassword && (
                            <div className="pwd-strength-container">
                              <div className="pwd-strength-bar">
                                {[1, 2, 3, 4].map((step) => (
                                  <div
                                    key={step}
                                    className="pwd-strength-segment"
                                    style={{
                                      backgroundColor:
                                        step <= strength.score ? strength.color : "var(--line)",
                                    }}
                                  />
                                ))}
                              </div>
                              <div className="pwd-strength-label">
                                <span>Strength:</span>
                                <strong style={{ color: strength.color }}>
                                  {strength.label}
                                </strong>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Confirm Password */}
                        <div className="pwd-field-group">
                          <label className="pwd-label" htmlFor="confirm-pwd-input">
                            Confirm Open Password
                          </label>
                          <div className="pwd-input-wrap">
                            <input
                              id="confirm-pwd-input"
                              type={showConfirmPassword ? "text" : "password"}
                              className="pwd-text-input"
                              placeholder="Re-enter open password"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            <button
                              type="button"
                              className="pwd-eye-btn"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                            >
                              {showConfirmPassword ? "👁️‍🗨️" : "👁️"}
                            </button>
                          </div>

                          {confirmPassword && (
                            <div className="pwd-match-indicator">
                              {passwordsMatch ? (
                                <span className="match-success">✓ Passwords match</span>
                              ) : (
                                <span className="match-error">✕ Passwords do not match</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Master / Owner Password */}
                    <div className="pwd-section">
                      <label className="pwd-checkbox-label">
                        <input
                          type="checkbox"
                          checked={useSeparateOwnerPassword}
                          onChange={(e) => setUseSeparateOwnerPassword(e.target.checked)}
                        />
                        <strong>Set separate Permissions Master Password (Recommended)</strong>
                      </label>
                      <p className="pwd-section-desc">
                        Allows recipients to open the PDF with the user password, but prevents them
                        from modifying security settings or removing printing/copying restrictions
                        without the master password.
                      </p>

                      {useSeparateOwnerPassword && (
                        <div className="pwd-field-group" style={{ maxWidth: 460, marginTop: 12 }}>
                          <label className="pwd-label" htmlFor="owner-pwd-input">
                            Master Permissions Password
                          </label>
                          <div className="pwd-input-wrap">
                            <input
                              id="owner-pwd-input"
                              type={showOwnerPassword ? "text" : "password"}
                              className="pwd-text-input"
                              placeholder="Enter master permissions password"
                              value={ownerPassword}
                              onChange={(e) => setOwnerPassword(e.target.value)}
                            />
                            <button
                              type="button"
                              className="pwd-eye-btn"
                              onClick={() => setShowOwnerPassword(!showOwnerPassword)}
                              aria-label={showOwnerPassword ? "Hide password" : "Show password"}
                            >
                              {showOwnerPassword ? "👁️‍🗨️" : "👁️"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Encryption Level & Permissions */}
                    <div className="pwd-section">
                      <h3>2. Security &amp; Permissions</h3>

                      <div className="pwd-field-group">
                        <label className="pwd-label">Encryption Algorithm</label>
                        <div className="pwd-radio-group">
                          <label className="pwd-radio-item">
                            <input
                              type="radio"
                              name="keyLength"
                              value={256}
                              checked={keyLength === 256}
                              onChange={() => setKeyLength(256)}
                            />
                            <div>
                              <strong>256-bit AES Encryption (Recommended)</strong>
                              <span>
                                Military-grade security. Supported by all modern PDF viewers &amp;
                                browsers.
                              </span>
                            </div>
                          </label>

                          <label className="pwd-radio-item">
                            <input
                              type="radio"
                              name="keyLength"
                              value={128}
                              checked={keyLength === 128}
                              onChange={() => setKeyLength(128)}
                            />
                            <div>
                              <strong>128-bit AES Encryption</strong>
                              <span>
                                Standard security for compatibility with older legacy software.
                              </span>
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Permissions Matrix */}
                      <div className="pwd-permissions-grid">
                        <div className="pwd-field-group">
                          <label className="pwd-label" htmlFor="print-perm-select">
                            🖨️ Printing Rights
                          </label>
                          <select
                            id="print-perm-select"
                            className="pwd-select"
                            value={printPerm}
                            onChange={(e) => setPrintPerm(e.target.value as any)}
                          >
                            <option value="full">Allow High-Resolution Printing</option>
                            <option value="low">Allow Low-Resolution (Draft Only)</option>
                            <option value="none">Block Printing Completely</option>
                          </select>
                        </div>

                        <div className="pwd-field-group">
                          <label className="pwd-label" htmlFor="modify-perm-select">
                            ✏️ Content Modification
                          </label>
                          <select
                            id="modify-perm-select"
                            className="pwd-select"
                            value={modifyPerm}
                            onChange={(e) => setModifyPerm(e.target.value as any)}
                          >
                            <option value="all">Allow Full Modification</option>
                            <option value="annotate">Allow Annotations &amp; Form Filling</option>
                            <option value="form">Allow Form Filling &amp; Signing Only</option>
                            <option value="assembly">Allow Page Assembly Only</option>
                            <option value="none">Block All Document Changes</option>
                          </select>
                        </div>

                        <div className="pwd-field-group">
                          <label className="pwd-checkbox-label">
                            <input
                              type="checkbox"
                              checked={allowExtract}
                              onChange={(e) => setAllowExtract(e.target.checked)}
                            />
                            <span>Allow copying text, graphics, and content</span>
                          </label>
                        </div>

                        <div className="pwd-field-group">
                          <label className="pwd-checkbox-label">
                            <input
                              type="checkbox"
                              checked={allowAccessibility}
                              onChange={(e) => setAllowAccessibility(e.target.checked)}
                            />
                            <span>Allow screen readers for assistive devices</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="pwd-action-box">
                      <button
                        type="button"
                        className="download-button"
                        onClick={handleLockPdf}
                        disabled={busy || !passwordsMatch || (!userPassword && !ownerPassword)}
                      >
                        {busy ? "Encrypting Document…" : "🔒 Lock & Protect PDF ↓"}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* UNLOCK MODE FORM */
                  <div className="pwd-form-body">
                    {isEncrypted === true ? (
                      <div className="pwd-notice-banner success">
                        <span className="notice-icon">🔒</span>
                        <div>
                          <strong>Password-protected PDF detected</strong>
                          <p>
                            Enter the open password or permissions master password below to
                            permanently remove encryption.
                          </p>
                        </div>
                      </div>
                    ) : isEncrypted === false ? (
                      <div className="pwd-notice-banner info">
                        <span className="notice-icon">ℹ️</span>
                        <div>
                          <strong>This document does not require an open password</strong>
                          <p>
                            If it has restrictive owner permissions (e.g. printing or copying
                            blocked), you can still unlock it below by entering the master password
                            or leaving it blank if unrestricted.
                          </p>
                        </div>
                      </div>
                    ) : null}

                    <div className="pwd-section" style={{ maxWidth: 480 }}>
                      <label className="pwd-label" htmlFor="unlock-pwd-input">
                        Document Password
                      </label>
                      <div className="pwd-input-wrap">
                        <input
                          id="unlock-pwd-input"
                          type={showUnlockPassword ? "text" : "password"}
                          className="pwd-text-input"
                          placeholder="Enter password to unlock"
                          value={unlockPassword}
                          onChange={(e) => setUnlockPassword(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleUnlockPdf();
                          }}
                        />
                        <button
                          type="button"
                          className="pwd-eye-btn"
                          onClick={() => setShowUnlockPassword(!showUnlockPassword)}
                          aria-label={showUnlockPassword ? "Hide password" : "Show password"}
                        >
                          {showUnlockPassword ? "👁️‍🗨️" : "👁️"}
                        </button>
                      </div>
                      <span className="pwd-label-hint">
                        Accepts either the document open password or master permissions password.
                      </span>
                    </div>

                    <div className="pwd-action-box" style={{ maxWidth: 480 }}>
                      <button
                        type="button"
                        className="download-button"
                        onClick={handleUnlockPdf}
                        disabled={busy}
                      >
                        {busy ? "Decrypting Document…" : "🔓 Unlock & Remove Restrictions ↓"}
                      </button>
                    </div>
                  </div>
                )}

                {message && (
                  <p className="success-message" role="status">
                    {message}
                  </p>
                )}
                {error && (
                  <p className="error-message" role="status">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <footer className="footer">
          <span>✦ Built for privacy</span>
          <span>Everything happens locally in your browser</span>
        </footer>
      </main>
    </div>
  );
}
