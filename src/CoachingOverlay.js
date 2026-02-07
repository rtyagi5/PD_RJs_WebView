// ---------------------------------------------
// CoachingOverlay.js
// Canvas drawing helpers for the coaching / countdown / inactive states.
// Called from the detection loop — no React, just 2D canvas API.
// ---------------------------------------------

import { IDEAL_BODY_RATIO } from './PoseQuality';

// ── Target Bounding Box ──────────────────────────────────────────────────────
// Draws a dashed rectangle showing where the patient should stand.
// `color` reflects coaching status: red / yellow / green.

export function drawTargetBox(ctx, frameW, frameH, idealBodyRatio, color) {
  const ratio = idealBodyRatio ?? IDEAL_BODY_RATIO;

  // Box dimensions: width ~40 % of frame, height from ratio
  const boxH = frameH * ratio;
  const boxW = frameW * 0.38;

  // Centered, slight vertical offset (body center ≈ 45 % from top)
  const boxX = (frameW - boxW) / 2;
  const boxY = (frameH - boxH) / 2 - frameH * 0.02;

  ctx.save();

  // Semi-transparent fill
  ctx.fillStyle = hexToRGBA(color, 0.08);
  ctx.fillRect(boxX, boxY, boxW, boxH);

  // Dashed border
  ctx.setLineDash([12, 8]);
  ctx.strokeStyle = hexToRGBA(color, 0.6);
  ctx.lineWidth = 3;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  // Corner brackets for visual emphasis
  const bracketLen = Math.min(boxW, boxH) * 0.12;
  ctx.setLineDash([]);
  ctx.strokeStyle = hexToRGBA(color, 0.9);
  ctx.lineWidth = 4;
  drawCornerBrackets(ctx, boxX, boxY, boxW, boxH, bracketLen);

  ctx.restore();
}

// ── Coaching Messages ────────────────────────────────────────────────────────
// Draws coaching text at the top of the screen.

export function drawCoachingMessages(ctx, frameW, frameH, checks) {
  const failing = (checks || []).filter(c => c.status !== 'good' && c.message);
  if (failing.length === 0) return;

  // Show the highest-priority failing message
  const priorityOrder = ['visibility', 'distance', 'angle', 'lighting'];
  let primary = failing[0];
  for (const name of priorityOrder) {
    const found = failing.find(c => c.name === name);
    if (found) { primary = found; break; }
  }

  const text = primary.message;
  const y = frameH * 0.08;

  ctx.save();

  // Background pill
  ctx.font = `bold ${Math.round(frameH * 0.035)}px sans-serif`;
  const metrics = ctx.measureText(text);
  const padX = 24;
  const padY = 14;
  const pillW = metrics.width + padX * 2;
  const pillH = frameH * 0.035 + padY * 2;
  const pillX = (frameW - pillW) / 2;
  const pillY = y - padY - frameH * 0.02;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  roundRect(ctx, pillX, pillY, pillW, pillH, 12);
  ctx.fill();

  // Text
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, frameW / 2, pillY + pillH / 2);

  ctx.restore();
}

// ── Countdown Number ─────────────────────────────────────────────────────────

export function drawCountdown(ctx, frameW, frameH, secondsRemaining) {
  if (secondsRemaining == null || secondsRemaining <= 0) return;

  const text = String(secondsRemaining);

  ctx.save();

  // Large centered number with glow
  const fontSize = Math.round(frameH * 0.18);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Glow
  ctx.shadowColor = '#00E676';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#00E676';
  ctx.fillText(text, frameW / 2, frameH * 0.45);

  // Subtitle
  ctx.shadowBlur = 0;
  ctx.font = `bold ${Math.round(frameH * 0.03)}px sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText('Get ready…', frameW / 2, frameH * 0.56);

  ctx.restore();
}

// ── Inactive Overlay ─────────────────────────────────────────────────────────

export function drawInactiveOverlay(ctx, frameW, frameH) {
  ctx.save();

  // Dim the screen
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, frameW, frameH);

  // Message
  const fontSize = Math.round(frameH * 0.04);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFD740';
  ctx.fillText('Return to the frame to continue', frameW / 2, frameH * 0.45);

  ctx.font = `${Math.round(frameH * 0.025)}px sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillText('Your exercise is paused', frameW / 2, frameH * 0.52);

  ctx.restore();
}

// ── Loading Overlay ──────────────────────────────────────────────────────────

export function drawLoadingOverlay(ctx, frameW, frameH) {
  ctx.save();
  const fontSize = Math.round(frameH * 0.035);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText('Loading pose detector…', frameW / 2, frameH / 2);
  ctx.restore();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRGBA(hex, alpha) {
  // Support shorthand or 6-char hex
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawCornerBrackets(ctx, x, y, w, h, len) {
  // Top-left
  ctx.beginPath();
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.stroke();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.stroke();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x, y + h - len); ctx.lineTo(x, y + h); ctx.lineTo(x + len, y + h);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + w - len, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - len);
  ctx.stroke();
}

// ── Color Picker ─────────────────────────────────────────────────────────────
// Returns the bounding-box color based on how many coaching checks are passing.

export function coachingColor(checks) {
  const failing = (checks || []).filter(c => c.status !== 'good');
  // Exclude lighting from the count (it's P2 / advisory)
  const p0Failing = failing.filter(c => c.name !== 'lighting');
  if (p0Failing.length === 0) return '#00E676'; // green
  if (p0Failing.length === 1) return '#FFD740'; // yellow
  return '#FF5252'; // red
}
