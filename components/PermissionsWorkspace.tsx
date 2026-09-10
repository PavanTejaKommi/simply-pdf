"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { downloadPdf } from "../lib/pdf";
import {
  applyPdfPermissions,
  decryptPdf,
  checkPdfEncrypted,
} from "../lib/pdf-security";

type PermissionProfile = "readonly" | "forms" | "review" | "draft" | "custom";

interface PermissionsWorkspaceProps {
  initialTab?: "configure" | "remove";
}

export function PermissionsWorkspace({
  initialTab = "configure",
}: PermissionsWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"configure" | "remove">(initialTab);
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [isEncrypted, setIsEncrypted] = useState<boolean | null>(null);
  const [fileChecking, setFileChecking] = useState<boolean>(false);

  // Preset Profile
  const [profile, setProfile] = useState<PermissionProfile>("readonly");

  // Granular Permissions
  const [printOption, setPrintOption] = useState<"full" | "low" | "none">("none");
  const [allowCopy, setAllowCopy] = useState<boolean>(false);
  const [modifyOption, setModifyOption] = useState<
    "all" | "assembly" | "form" | "annotate" | "none"
  >("none");
  const [allowAccessibility, setAllowAccessibility] = useState<boolean>(true);

  // Master Permissions Password
  const [permissionsPassword, setPermissionsPassword] = useState<string>("");
  const [confirmPermPassword, setConfirmPermPassword] = useState<string>("");
  const [showPermPassword, setShowPermPassword] = useState<boolean>(false);
  const [showConfirmPermPassword, setShowConfirmPermPassword] = useState<boolean>(false);

  // Optional Document Open Password
  const [requireOpenPassword, setRequireOpenPassword] = useState<boolean>(false);
  const [openPassword, setOpenPassword] = useState<string>("");
  const [confirmOpenPassword, setConfirmOpenPassword] = useState<string>("");
  const [showOpenPassword, setShowOpenPassword] = useState<boolean>(false);
  const [showConfirmOpenPassword, setShowConfirmOpenPassword] = useState<boolean>(false);

  const [keyLength, setKeyLength] = useState<128 | 256>(256);

  // Remove Restrictions Tab State
  const [existingPassword, setExistingPassword] = useState<string>("");
  const [showExistingPassword, setShowExistingPassword] = useState<boolean>(false);

  // State Feedback
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Apply preset profile definitions
  const applyProfile = (selected: PermissionProfile) => {
    setProfile(selected);
    switch (selected) {
      case "readonly":
        setPrintOption("none");
        setAllowCopy(false);
        setModifyOption("none");
        setAllowAccessibility(true);
        break;
      case "forms":
        setPrintOption("full");
        setAllowCopy(false);
        setModifyOption("form");
        setAllowAccessibility(true);
        break;
      case "review":
        setPrintOption("full");
        setAllowCopy(true);
        setModifyOption("annotate");
        setAllowAccessibility(true);
        break;
      case "draft":
        setPrintOption("low");
        setAllowCopy(false);
        setModifyOption("none");
        setAllowAccessibility(true);
        break;
      case "custom":
        break;
    }
  };

  // Check file encryption status whenever a new file is provided
  useEffect(() => {
    if (!file) {
      setFileBuffer(null);
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
        const buffer = await file.arrayBuffer();
        if (!isMounted) return;
        setFileBuffer(buffer);

        const encInfo = await checkPdfEncrypted(buffer);
        if (!isMounted) return;
        setIsEncrypted(encInfo.isEncrypted);

        // If file is encrypted and user is on configure tab, auto-suggest remove restrictions
        if (encInfo.isEncrypted && activeTab === "configure") {
          setActiveTab("remove");
          setMessage(
            "This document is already password-protected or restricted. Switched to 'Remove Restrictions' tab."
          );
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
  }, [file, activeTab]);

  // Password strength evaluator matching PasswordWorkspace
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

  const permStrength = evaluateStrength(permissionsPassword);
  const passwordsMatch = permissionsPassword === confirmPermPassword;
  const openPasswordsMatch = openPassword === confirmOpenPassword;

  const handleFile = (selectedFile: File) => {
    setError("");
    setMessage("");

    if (
      selectedFile.type !== "application/pdf" &&
      !selectedFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Please select a valid PDF file.");
      return;
    }

    setFile(selectedFile);
  };

  // Handle Apply Permissions
  const handleApplyPermissions = async () => {
    if (!file || !fileBuffer) {
      setError("Please select a PDF file first.");
      return;
    }

    if (!permissionsPassword) {
      setError("Please set a Permissions Master Password to protect these settings.");
      return;
    }

    if (permissionsPassword !== confirmPermPassword) {
      setError("Permissions master passwords do not match. Please verify confirmation password.");
      return;
    }

    if (requireOpenPassword) {
      if (!openPassword) {
        setError(
          "Please enter a Document Open Password, or uncheck 'Also require a password to view / open document'."
        );
        return;
      }
      if (openPassword !== confirmOpenPassword) {
        setError("Document Open passwords do not match. Please verify confirmation password.");
        return;
      }
    }

    setIsProcessing(true);
    setError("");
    setMessage("");

    try {
      const outputBytes = await applyPdfPermissions({
        input: fileBuffer,
        permissionsPassword,
        requireOpenPassword,
        openPassword: requireOpenPassword ? openPassword : "",
        keyLength,
        print: printOption,
        modify: modifyOption,
        extract: allowCopy,
        annotate: modifyOption === "annotate" || modifyOption === "all",
        accessibility: allowAccessibility,
      });

      const baseName = file.name.replace(/\.pdf$/i, "");
      downloadPdf(outputBytes, `${baseName}-restricted.pdf`);

      setMessage(
        "Success! Document permissions enforced with 256-bit AES encryption. The restricted PDF was downloaded directly to your computer."
      );
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to apply permissions. Please check that the file is not corrupted.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Remove Restrictions
  const handleRemoveRestrictions = async () => {
    if (!file || !fileBuffer) {
      setError("Please select a restricted PDF file first.");
      return;
    }

    setIsProcessing(true);
    setError("");
    setMessage("");

    try {
      const outputBytes = await decryptPdf({
        input: fileBuffer,
        password: existingPassword,
      });

      const baseName = file.name.replace(/\.pdf$/i, "");
      downloadPdf(outputBytes, `${baseName}-unrestricted.pdf`);

      setMessage(
        "Success! All permissions and password locks removed. The unrestricted PDF was downloaded directly to your computer."
      );
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message ||
          "Failed to remove permissions. Please verify the master or open password is correct."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setFileBuffer(null);
    setIsEncrypted(null);
    setPermissionsPassword("");
    setConfirmPermPassword("");
    setOpenPassword("");
    setConfirmOpenPassword("");
    setExistingPassword("");
    setMessage("");
    setError("");
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
            <h1>PDF Permissions Studio</h1>
            <p className="description">
              Set granular recipient permissions for printing, editing, copying, and screen readers with 256-bit AES encryption. 100% client-side privacy.
            </p>
          </div>

          <div className="password-studio-container">
            {/* Mode Navigation Tabs */}
            <div className="pwd-tabs-nav" role="tablist">
              <button
                type="button"
                className={`pwd-tab-btn ${activeTab === "configure" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("configure");
                  setMessage("");
                  setError("");
                }}
              >
                <span className="tab-icon">🛡️</span> Configure Permissions
              </button>
              <button
                type="button"
                className={`pwd-tab-btn ${activeTab === "remove" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("remove");
                  setMessage("");
                  setError("");
                }}
              >
                <span className="tab-icon">🔓</span> Remove Restrictions
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
                  if (f) handleFile(f);
                }}
              >
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <span className="upload-icon">{activeTab === "configure" ? "🛡️" : "🔓"}</span>
                <strong>
                  {activeTab === "configure"
                    ? "Drop PDF to configure permissions"
                    : "Drop restricted PDF to unlock permissions"}
                </strong>
                <span className="upload-hint">
                  or click to browse · processed locally in your browser
                </span>
              </label>
            ) : (
              <div className="pwd-workspace-card">
                {/* File Details Banner */}
                <div className="pwd-file-banner">
                  <div className="file-info-group">
                    <span
                      className={`file-type-badge ${
                        isEncrypted ? "badge-locked" : "badge-pdf"
                      }`}
                    >
                      {isEncrypted ? "🔒 RESTRICTED" : "PDF"}
                    </span>
                    <div>
                      <strong>{file.name}</strong>
                      <span className="file-subtext">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                        {fileChecking
                          ? " · Checking security status…"
                          : isEncrypted === true
                          ? " · Password-protected / Restricted"
                          : isEncrypted === false
                          ? " · Unprotected document"
                          : ""}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="reset-button"
                    onClick={handleReset}
                    disabled={isProcessing}
                  >
                    Choose another file
                  </button>
                </div>

                {/* CONFIGURE PERMISSIONS MODE */}
                {activeTab === "configure" && (
                  <div className="pwd-form-body">
                    {isEncrypted && (
                      <div className="pwd-notice-banner warning">
                        <span className="notice-icon">⚠️</span>
                        <div>
                          <strong>This document is already restricted or password-protected</strong>
                          <p>
                            To change permissions or re-encrypt, switch to the{" "}
                            <strong>Remove Restrictions</strong> tab first with the current master password.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Section 1: Presets */}
                    <div className="pwd-section">
                      <h3>1. Quick Permission Presets</h3>
                      <p className="pwd-section-desc">
                        Select a pre-configured rights profile or adjust the flags individually below.
                      </p>
                      <div className="perm-profile-grid">
                        {[
                          {
                            id: "readonly",
                            name: "Read-only",
                            desc: "Block print, editing, and copying",
                          },
                          {
                            id: "forms",
                            name: "Forms & Sign",
                            desc: "Allow form fields & full quality print",
                          },
                          {
                            id: "review",
                            name: "Review & Comment",
                            desc: "Allow comments, copying & full print",
                          },
                          {
                            id: "draft",
                            name: "Draft Distribution",
                            desc: "Low-res (150 DPI) print only",
                          },
                          {
                            id: "custom",
                            name: "Custom Matrix",
                            desc: "Full granular control of all flags",
                          },
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={`perm-chip ${profile === p.id ? "active" : ""}`}
                            onClick={() => applyProfile(p.id as PermissionProfile)}
                          >
                            <strong>{p.name}</strong>
                            <span>{p.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Section 2: Granular Rights */}
                    <div className="pwd-section">
                      <h3>2. Granular Document Rights</h3>
                      <p className="pwd-section-desc">
                        Define exact permissions for printing, editing, and copying without master password.
                      </p>

                      <div className="pwd-permissions-grid">
                        <div className="pwd-field-group">
                          <label className="pwd-label">🖨️ Printing Permissions</label>
                          <select
                            className="pwd-select"
                            value={printOption}
                            onChange={(e) => {
                              setPrintOption(e.target.value as any);
                              setProfile("custom");
                            }}
                          >
                            <option value="full">Allow full high-quality printing</option>
                            <option value="low">Allow low-resolution (150 DPI) printing only</option>
                            <option value="none">Block all printing</option>
                          </select>
                        </div>

                        <div className="pwd-field-group">
                          <label className="pwd-label">✏️ Document Modification Rights</label>
                          <select
                            className="pwd-select"
                            value={modifyOption}
                            onChange={(e) => {
                              setModifyOption(e.target.value as any);
                              setProfile("custom");
                            }}
                          >
                            <option value="all">Allow all modifications</option>
                            <option value="assembly">Page assembly only (insert, delete, rotate)</option>
                            <option value="form">Fill form fields and sign only</option>
                            <option value="annotate">Comments and annotations only</option>
                            <option value="none">Block all modifications</option>
                          </select>
                        </div>
                      </div>

                      <div className="perm-checkbox-row">
                        <label className="pwd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={allowCopy}
                            onChange={(e) => {
                              setAllowCopy(e.target.checked);
                              setProfile("custom");
                            }}
                          />
                          <span>Allow content copying (text and images)</span>
                        </label>

                        <label className="pwd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={allowAccessibility}
                            onChange={(e) => {
                              setAllowAccessibility(e.target.checked);
                              setProfile("custom");
                            }}
                          />
                          <span>Allow screen readers and accessibility tools</span>
                        </label>
                      </div>
                    </div>

                    {/* Section 3: Master Password Protection */}
                    <div className="pwd-section">
                      <h3>3. Master Permissions Password</h3>
                      <p className="pwd-section-desc">
                        Protects your permissions settings. Anyone can read the document freely, but only users with this master password can bypass or modify restrictions in software like Adobe Acrobat.
                      </p>

                      <div className="pwd-grid-2">
                        {/* Master Password Input */}
                        <div className="pwd-field-group">
                          <label className="pwd-label" htmlFor="perm-pwd-input">
                            Permissions Master Password *
                          </label>
                          <div className="pwd-input-wrap">
                            <input
                              id="perm-pwd-input"
                              type={showPermPassword ? "text" : "password"}
                              className="pwd-text-input"
                              placeholder="Enter master password"
                              value={permissionsPassword}
                              onChange={(e) => setPermissionsPassword(e.target.value)}
                            />
                            <button
                              type="button"
                              className="pwd-eye-btn"
                              onClick={() => setShowPermPassword(!showPermPassword)}
                              aria-label={showPermPassword ? "Hide password" : "Show password"}
                            >
                              {showPermPassword ? "👁️‍🗨️" : "👁️"}
                            </button>
                          </div>

                          {/* Visual 4-Segment Strength Meter */}
                          {permissionsPassword && (
                            <div className="pwd-strength-container">
                              <div className="pwd-strength-bar">
                                {[1, 2, 3, 4].map((step) => (
                                  <div
                                    key={step}
                                    className="pwd-strength-segment"
                                    style={{
                                      backgroundColor:
                                        step <= permStrength.score
                                          ? permStrength.color
                                          : "var(--line)",
                                    }}
                                  />
                                ))}
                              </div>
                              <div className="pwd-strength-label">
                                <span>Strength:</span>
                                <strong style={{ color: permStrength.color }}>
                                  {permStrength.label}
                                </strong>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Confirm Master Password */}
                        <div className="pwd-field-group">
                          <label className="pwd-label" htmlFor="perm-confirm-pwd-input">
                            Confirm Master Password *
                          </label>
                          <div className="pwd-input-wrap">
                            <input
                              id="perm-confirm-pwd-input"
                              type={showConfirmPermPassword ? "text" : "password"}
                              className="pwd-text-input"
                              placeholder="Re-enter master password"
                              value={confirmPermPassword}
                              onChange={(e) => setConfirmPermPassword(e.target.value)}
                            />
                            <button
                              type="button"
                              className="pwd-eye-btn"
                              onClick={() =>
                                setShowConfirmPermPassword(!showConfirmPermPassword)
                              }
                              aria-label={
                                showConfirmPermPassword ? "Hide password" : "Show password"
                              }
                            >
                              {showConfirmPermPassword ? "👁️‍🗨️" : "👁️"}
                            </button>
                          </div>

                          {confirmPermPassword && (
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

                      {/* Optional View Password Checkbox */}
                      <div style={{ marginTop: 12 }}>
                        <label className="pwd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={requireOpenPassword}
                            onChange={(e) => setRequireOpenPassword(e.target.checked)}
                          />
                          <strong>Also require a password to view / open document</strong>
                        </label>
                      </div>

                      {requireOpenPassword && (
                        <div className="pwd-grid-2" style={{ marginTop: 12 }}>
                          <div className="pwd-field-group">
                            <label className="pwd-label" htmlFor="open-pwd-input">
                              Document Open Password *
                            </label>
                            <div className="pwd-input-wrap">
                              <input
                                id="open-pwd-input"
                                type={showOpenPassword ? "text" : "password"}
                                className="pwd-text-input"
                                placeholder="Enter view password"
                                value={openPassword}
                                onChange={(e) => setOpenPassword(e.target.value)}
                              />
                              <button
                                type="button"
                                className="pwd-eye-btn"
                                onClick={() => setShowOpenPassword(!showOpenPassword)}
                                aria-label={showOpenPassword ? "Hide password" : "Show password"}
                              >
                                {showOpenPassword ? "👁️‍🗨️" : "👁️"}
                              </button>
                            </div>
                          </div>

                          <div className="pwd-field-group">
                            <label className="pwd-label" htmlFor="open-confirm-pwd-input">
                              Confirm Open Password *
                            </label>
                            <div className="pwd-input-wrap">
                              <input
                                id="open-confirm-pwd-input"
                                type={showConfirmOpenPassword ? "text" : "password"}
                                className="pwd-text-input"
                                placeholder="Re-enter view password"
                                value={confirmOpenPassword}
                                onChange={(e) => setConfirmOpenPassword(e.target.value)}
                              />
                              <button
                                type="button"
                                className="pwd-eye-btn"
                                onClick={() =>
                                  setShowConfirmOpenPassword(!showConfirmOpenPassword)
                                }
                                aria-label={
                                  showConfirmOpenPassword ? "Hide password" : "Show password"
                                }
                              >
                                {showConfirmOpenPassword ? "👁️‍🗨️" : "👁️"}
                              </button>
                            </div>

                            {confirmOpenPassword && (
                              <div className="pwd-match-indicator">
                                {openPasswordsMatch ? (
                                  <span className="match-success">✓ Passwords match</span>
                                ) : (
                                  <span className="match-error">✕ Passwords do not match</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Encryption Algorithm Selection */}
                      <div className="pwd-field-group" style={{ marginTop: 16 }}>
                        <label className="pwd-label">Encryption Standard</label>
                        <div className="pwd-radio-group">
                          <label className="pwd-radio-item">
                            <input
                              type="radio"
                              name="permKeyLength"
                              value={256}
                              checked={keyLength === 256}
                              onChange={() => setKeyLength(256)}
                            />
                            <div>
                              <strong>256-bit AES (Recommended)</strong>
                              <span>
                                Industry-standard security enforced by Adobe Acrobat and modern PDF viewers.
                              </span>
                            </div>
                          </label>
                          <label className="pwd-radio-item">
                            <input
                              type="radio"
                              name="permKeyLength"
                              value={128}
                              checked={keyLength === 128}
                              onChange={() => setKeyLength(128)}
                            />
                            <div>
                              <strong>128-bit AES (Legacy Compatibility)</strong>
                              <span>Compatible with older PDF readers (Acrobat 7.0+).</span>
                            </div>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Section 4: Effective Rights Summary Box */}
                    <div className="perm-summary-banner">
                      <div className="perm-summary-title">Effective Recipient Rights:</div>
                      <div className="perm-summary-pills">
                        <span
                          className={`perm-summary-pill ${
                            requireOpenPassword ? "warn" : "good"
                          }`}
                        >
                          👁️ Viewing: {requireOpenPassword ? "Password Required" : "Public (Free)"}
                        </span>
                        <span
                          className={`perm-summary-pill ${
                            printOption === "full"
                              ? "good"
                              : printOption === "low"
                              ? "warn"
                              : "bad"
                          }`}
                        >
                          🖨️ Printing:{" "}
                          {printOption === "full"
                            ? "Full Quality"
                            : printOption === "low"
                            ? "Low-Res (150 DPI)"
                            : "Blocked"}
                        </span>
                        <span
                          className={`perm-summary-pill ${
                            modifyOption === "all"
                              ? "good"
                              : modifyOption === "none"
                              ? "bad"
                              : "warn"
                          }`}
                        >
                          ✏️ Editing:{" "}
                          {modifyOption === "all"
                            ? "Full Editing"
                            : modifyOption === "form"
                            ? "Forms & Sign Only"
                            : modifyOption === "annotate"
                            ? "Comments Only"
                            : modifyOption === "assembly"
                            ? "Assembly Only"
                            : "Blocked"}
                        </span>
                        <span className={`perm-summary-pill ${allowCopy ? "good" : "bad"}`}>
                          📋 Copying: {allowCopy ? "Allowed" : "Blocked"}
                        </span>
                        <span
                          className={`perm-summary-pill ${
                            allowAccessibility ? "good" : "bad"
                          }`}
                        >
                          ♿ Screen Readers: {allowAccessibility ? "Allowed" : "Blocked"}
                        </span>
                      </div>
                    </div>

                    {/* Action Execution */}
                    <div className="pwd-action-box">
                      <button
                        type="button"
                        className="download-button"
                        onClick={handleApplyPermissions}
                        disabled={
                          isProcessing ||
                          !permissionsPassword ||
                          permissionsPassword !== confirmPermPassword ||
                          (requireOpenPassword &&
                            (!openPassword || openPassword !== confirmOpenPassword))
                        }
                      >
                        {isProcessing
                          ? "Applying Permissions..."
                          : "Apply Permissions & Download PDF ↓"}
                      </button>
                    </div>
                  </div>
                )}

                {/* REMOVE RESTRICTIONS MODE */}
                {activeTab === "remove" && (
                  <div className="pwd-form-body">
                    <div className="pwd-section">
                      <h3>Remove Document Permissions &amp; Passwords</h3>
                      <p className="pwd-section-desc">
                        Enter the master permissions password (or user open password) to permanently decrypt the PDF and remove all printing, editing, and copying restrictions.
                      </p>

                      <div className="pwd-field-group" style={{ maxWidth: 460 }}>
                        <label className="pwd-label" htmlFor="existing-perm-pwd">
                          Known Password
                        </label>
                        <div className="pwd-input-wrap">
                          <input
                            id="existing-perm-pwd"
                            type={showExistingPassword ? "text" : "password"}
                            className="pwd-text-input"
                            placeholder="Enter master or open password"
                            value={existingPassword}
                            onChange={(e) => setExistingPassword(e.target.value)}
                          />
                          <button
                            type="button"
                            className="pwd-eye-btn"
                            onClick={() => setShowExistingPassword(!showExistingPassword)}
                            aria-label={showExistingPassword ? "Hide password" : "Show password"}
                          >
                            {showExistingPassword ? "👁️‍🗨️" : "👁️"}
                          </button>
                        </div>
                      </div>

                      <div className="pwd-action-box" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="download-button"
                          onClick={handleRemoveRestrictions}
                          disabled={isProcessing}
                        >
                          {isProcessing
                            ? "Removing Restrictions..."
                            : "Remove Restrictions & Download PDF ↓"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Messages */}
                {message && (
                  <div
                    className="pwd-notice-banner success"
                    style={{ margin: "0 24px 24px" }}
                  >
                    <span className="notice-icon">✓</span>
                    <div>
                      <strong>Operation Successful</strong>
                      <p>{message}</p>
                    </div>
                  </div>
                )}
                {error && (
                  <div
                    className="pwd-notice-banner warning"
                    style={{ margin: "0 24px 24px" }}
                  >
                    <span className="notice-icon">⚠️</span>
                    <div>
                      <strong>Notice</strong>
                      <p>{error}</p>
                    </div>
                  </div>
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
