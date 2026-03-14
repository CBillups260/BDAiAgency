import React, { useEffect, useRef } from 'react';

const TILE_W = 64;
const TILE_H = 32;

// ─── Color Palette ──────────────────────────────────────────
const PALETTE: Record<string, string> = {
  'k': '#111111',   // black outline
  'f': '#f1faee',   // white fur
  'e': '#ffb6c1',   // pink ears/nose
  'n': '#1a1a2e',   // eyes (dark)
  // Agent colors
  'O': '#a855f7',   // orchestrator purple
  'o': '#7c3aed',   // orchestrator dark
  'A': '#c084fc',   // accounts lilac
  'a': '#9333ea',   // accounts dark
  'S': '#60a5fa',   // services blue
  's': '#2563eb',   // services dark
  'R': '#34d399',   // reports emerald
  'r': '#059669',   // reports dark
  'F': '#fbbf24',   // financials amber
  'z': '#d97706',   // financials dark
  // Furniture
  'w': '#f8fafc',   // white
  'g': '#6c757d',   // grey
  'x': '#343a40',   // dark grey
  'D': '#212529',   // darker grey
  'p': '#22c55e',   // plant green
  'P': '#15803d',   // plant dark
  'd': '#6b4423',   // pot brown
  'c': '#1e293b',   // pc case
  'm': '#0f172a',   // screen dark
  'M': '#7c3aed',   // screen glow purple
  'B': '#3b82f6',   // screen glow blue
  'G': '#10b981',   // screen glow green
  'Y': '#f59e0b',   // screen glow yellow
  'W': '#a8dadc',   // window glass
  'C': '#3b82f6',   // cooler blue
  'b': '#1d4ed8',   // cooler dark blue
};

// ─── Sprites ────────────────────────────────────────────────

// Bunny agent - typing at desk (arms alternating)
const charTyping1 = (color: string, body: string): string[] => [
  `  kk  kk  `,
  ` k${color}ekk${color}ek `,
  ` k${color}${color}kk${color}${color}k `,
  ` k${color}${color}${color}${color}${color}${color}k `,
  ` k${color}n${color}${color}n${color}k `,
  ` k${color}${color}${color}${color}${color}${color}k `,
  `  k${color}ee${color}k  `,
  ` k${body}${body}${body}${body}${body}${body}k `,
  ` k${body}kk${body}${body}k `,
  `  k${body}${body}${body}${body}k  `,
];

const charTyping2 = (color: string, body: string): string[] => [
  `  kk  kk  `,
  ` k${color}ekk${color}ek `,
  ` k${color}${color}kk${color}${color}k `,
  ` k${color}${color}${color}${color}${color}${color}k `,
  ` k${color}n${color}${color}n${color}k `,
  ` k${color}${color}${color}${color}${color}${color}k `,
  `  k${color}ee${color}k  `,
  ` k${body}${body}${body}${body}${body}${body}k `,
  ` k${body}${body}kk${body}k `,
  `  k${body}${body}${body}${body}k  `,
];

const charStanding = (color: string, body: string): string[] => [
  `  kk  kk  `,
  ` k${color}ekk${color}ek `,
  ` k${color}${color}kk${color}${color}k `,
  ` k${color}${color}${color}${color}${color}${color}k `,
  ` k${color}n${color}${color}n${color}k `,
  ` k${color}${color}${color}${color}${color}${color}k `,
  `  k${color}ee${color}k  `,
  `  k${body}${body}${body}${body}k  `,
  `  k${body}${body}${body}${body}k  `,
  `   kkkk   `,
];

const monitorSprite = (glowColor: string): string[] => [
  `  kkkkkk  `,
  ` kcccccck `,
  ` kc${glowColor}${glowColor}${glowColor}${glowColor}ck `,
  ` kc${glowColor}${glowColor}${glowColor}${glowColor}ck `,
  ` kcccccck `,
  `   kcck   `,
  ` kcccccck `,
  `  kkkkkk  `,
];

const monitorBlinkSprite = (glowColor: string): string[] => [
  `  kkkkkk  `,
  ` kcccccck `,
  ` kcmmmmck `,
  ` kc${glowColor}${glowColor}${glowColor}${glowColor}ck `,
  ` kcccccck `,
  `   kcck   `,
  ` kcccccck `,
  `  kkkkkk  `,
];

const plantSprite = [
  `    kk    `,
  `   kppk   `,
  `  kppppk  `,
  ` kpPpPppk `,
  ` kppppPpk `,
  `  kppppk  `,
  `   kddk   `,
  `  kddddk  `,
  `  kddddk  `,
  `   kkkk   `,
];

const coolerSprite = [
  `   kkkk   `,
  `  kCCCCk  `,
  ` kCCCCCCk `,
  ` kCbCbCCk `,
  `  kCCCCk  `,
  `  kwwwwk  `,
  `  kwwwwk  `,
  `  kwwwwk  `,
  `  kwwwwk  `,
  `   kkkk   `,
];

const serverSprite = [
  `   kkkk   `,
  `  kxxxxk  `,
  ` kxMMMMxk `,
  ` kxggggxk `,
  ` kxxxxxxk `,
  ` kxMMMMxk `,
  ` kxggggxk `,
  ` kxxxxxxk `,
  ` kxMMMMxk `,
  ` kxggggxk `,
  ` kxxxxxxk `,
  `  kkkkkk  `,
];

const serverBlinkSprite = [
  `   kkkk   `,
  `  kxxxxk  `,
  ` kxDDDDxk `,
  ` kxggggxk `,
  ` kxxxxxxk `,
  ` kxMMMMxk `,
  ` kxggggxk `,
  ` kxxxxxxk `,
  ` kxDDDDxk `,
  ` kxggggxk `,
  ` kxxxxxxk `,
  `  kkkkkk  `,
];

const whiteboardSprite = [
  ` kkkkkkkk `,
  ` kwwwwwwk `,
  ` kwkwwkwk `,
  ` kwwwwwwk `,
  ` kwkkwkwk `,
  ` kwwwwwwk `,
  ` kkkkkkkk `,
  `  k    k  `,
  `  k    k  `,
  ` kk    kk `,
];

const coffeeSprite = [
  `   kkkk   `,
  `  kxxxxk  `,
  ` kxwwwwxk `,
  ` kxwwwwxk `,
  ` kxxxxxxk `,
  ` kxxMMxxk `,
  ` kxxwwxxk `,
  ` kxxxxxxk `,
  `  kkkkkk  `,
];

// ─── Drawing Functions ──────────────────────────────────────

function drawIsoTile(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, borderColor?: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - TILE_H / 2);
  ctx.lineTo(cx + TILE_W / 2, cy);
  ctx.lineTo(cx, cy + TILE_H / 2);
  ctx.lineTo(cx - TILE_W / 2, cy);
  ctx.closePath();
  ctx.fill();
  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function drawIsoBlock(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, colorTop: string, colorLeft: string, colorRight: string) {
  // Left face
  ctx.fillStyle = colorLeft;
  ctx.beginPath();
  ctx.moveTo(cx - TILE_W / 2, cy - h);
  ctx.lineTo(cx, cy + TILE_H / 2 - h);
  ctx.lineTo(cx, cy + TILE_H / 2);
  ctx.lineTo(cx - TILE_W / 2, cy);
  ctx.closePath();
  ctx.fill();
  // Right face
  ctx.fillStyle = colorRight;
  ctx.beginPath();
  ctx.moveTo(cx, cy + TILE_H / 2 - h);
  ctx.lineTo(cx + TILE_W / 2, cy - h);
  ctx.lineTo(cx + TILE_W / 2, cy);
  ctx.lineTo(cx, cy + TILE_H / 2);
  ctx.closePath();
  ctx.fill();
  // Top face
  ctx.fillStyle = colorTop;
  ctx.beginPath();
  ctx.moveTo(cx, cy - TILE_H / 2 - h);
  ctx.lineTo(cx + TILE_W / 2, cy - h);
  ctx.lineTo(cx, cy + TILE_H / 2 - h);
  ctx.lineTo(cx - TILE_W / 2, cy - h);
  ctx.closePath();
  ctx.fill();
  // Edge highlight
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawWallWithWindow(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, colorTop: string, colorLeft: string, colorRight: string, isLeftWall: boolean) {
  drawIsoBlock(ctx, cx, cy, h, colorTop, colorLeft, colorRight);
  ctx.fillStyle = 'rgba(168,218,220,0.5)';
  ctx.beginPath();
  if (isLeftWall) {
    ctx.moveTo(cx - TILE_W * 0.4, cy - h + TILE_H * 0.4);
    ctx.lineTo(cx - TILE_W * 0.1, cy - h + TILE_H * 0.55);
    ctx.lineTo(cx - TILE_W * 0.1, cy - h * 0.4 + TILE_H * 0.55);
    ctx.lineTo(cx - TILE_W * 0.4, cy - h * 0.4 + TILE_H * 0.4);
  } else {
    ctx.moveTo(cx + TILE_W * 0.1, cy - h + TILE_H * 0.55);
    ctx.lineTo(cx + TILE_W * 0.4, cy - h + TILE_H * 0.4);
    ctx.lineTo(cx + TILE_W * 0.4, cy - h * 0.4 + TILE_H * 0.4);
    ctx.lineTo(cx + TILE_W * 0.1, cy - h * 0.4 + TILE_H * 0.55);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius, radius / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number, spriteData: string[], scale: number) {
  const h = spriteData.length;
  const w = spriteData[0].length;
  const startX = cx - (w * scale) / 2;
  const startY = cy - h * scale;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const char = spriteData[y][x];
      if (char !== ' ') {
        const color = PALETTE[char];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(startX + x * scale, startY + y * scale, scale, scale);
        }
      }
    }
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, bgColor: string) {
  ctx.font = 'bold 9px monospace';
  const metrics = ctx.measureText(text);
  const pw = 8;
  const ph = 4;
  const w = metrics.width + pw * 2;
  const h = 16;

  // Badge background
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 4);
  ctx.fill();

  // Text
  ctx.fillStyle = '#0f0f0f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 1);
}

function drawConnectionLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, time: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -time * 0.02;
  ctx.globalAlpha = 0.25 + Math.sin(time * 0.003) * 0.1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawChatBubble(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, accentColor: string, opacity: number) {
  ctx.save();
  ctx.globalAlpha = opacity;

  ctx.font = 'bold 8px monospace';
  const metrics = ctx.measureText(text);
  const padX = 10;
  const padY = 6;
  const bw = metrics.width + padX * 2;
  const bh = 18 + padY;
  const bx = cx - bw / 2;
  const by = cy - bh;
  const tailSize = 5;
  const r = 6;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.roundRect(bx + 2, by + 2, bw, bh, r);
  ctx.fill();

  // Bubble body
  ctx.fillStyle = '#16162a';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, r);
  ctx.fill();

  // Accent border
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, r);
  ctx.stroke();

  // Tail (small triangle pointing down)
  ctx.fillStyle = '#16162a';
  ctx.beginPath();
  ctx.moveTo(cx - tailSize, by + bh - 1);
  ctx.lineTo(cx, by + bh + tailSize);
  ctx.lineTo(cx + tailSize, by + bh - 1);
  ctx.closePath();
  ctx.fill();
  // Tail border
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - tailSize - 0.5, by + bh);
  ctx.lineTo(cx, by + bh + tailSize);
  ctx.lineTo(cx + tailSize + 0.5, by + bh);
  ctx.stroke();
  // Cover the tail's top edge overlap with bubble fill
  ctx.fillStyle = '#16162a';
  ctx.fillRect(cx - tailSize + 1, by + bh - 2, tailSize * 2 - 2, 3);

  // Small accent dot (typing indicator feel)
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(bx + 7, by + bh / 2, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Text
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, by + bh / 2 + 1);

  ctx.restore();
}

// ─── Entity Types ───────────────────────────────────────────

type AgentConfig = {
  fur: string;
  body: string;
  glow: string;
  label: string;
};

const AGENTS: Record<string, AgentConfig> = {
  orchestrator: { fur: 'O', body: 'o', glow: 'M', label: 'ORCHESTRATOR' },
  accounts:     { fur: 'A', body: 'a', glow: 'M', label: 'ACCOUNTS' },
  services:     { fur: 'S', body: 's', glow: 'B', label: 'SERVICES' },
  reports:      { fur: 'R', body: 'r', glow: 'G', label: 'REPORTS' },
  financials:   { fur: 'F', body: 'z', glow: 'Y', label: 'FINANCIALS' },
};

// ─── Mock Tasks (chat bubble messages) ──────────────────────

const AGENT_TASKS: Record<string, string[]> = {
  orchestrator: [
    'Syncing all agents...',
    'Delegating tasks',
    'Checking system health',
    'Routing new request',
    'Balancing workloads',
    'Coordinating reports',
  ],
  accounts: [
    'Drafting email to Pinnacle',
    'Following up w/ NovaTech',
    'Onboarding Meridian Labs',
    'Upsell pitch for Crestline',
    'Scheduling client sync',
    'Reviewing client notes',
  ],
  services: [
    'Updating Paid Ads SOP',
    'Pricing new SEO package',
    'Training doc for socials',
    'Vendor contract review',
    'Building service template',
    'Auditing deliverables',
  ],
  reports: [
    'Generating March report',
    'Pulling GA4 analytics',
    'Social media insights',
    'Building KPI dashboard',
    'Comparing Q1 vs Q2 data',
    'Exporting client metrics',
  ],
  financials: [
    'Scope creep: Orion Creative',
    'Margin analysis running',
    'Revenue forecast update',
    'Flagging overdue invoices',
    'Calculating profit margins',
    'Budget review for Q2',
  ],
};

type Entity = {
  type: string;
  x: number;
  y: number;
  z?: number;
  agentId?: string;
  animOffset?: number;
  state?: 'typing' | 'standing';
};

// ─── Component ──────────────────────────────────────────────

interface IsometricOfficeProps {
  activeAgentCount: number;
  currentTasks?: Record<string, string>;
}

export default function IsometricOffice({ activeAgentCount, currentTasks }: IsometricOfficeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mapSize = 12;
    const entities: Entity[] = [];

    // ── Walls ──
    for (let i = 0; i < mapSize; i++) {
      entities.push({ type: 'wall_left', x: -1, y: i });
      entities.push({ type: 'wall_right', x: i, y: -1 });
    }
    entities.push({ type: 'wall_corner', x: -1, y: -1 });

    // ── Server room partition (top-left) ──
    for (let i = 0; i < 3; i++) {
      entities.push({ type: 'wall_inner', x: 3, y: i });
      if (i !== 1) entities.push({ type: 'wall_inner', x: i, y: 3 });
    }

    // ── Workstation helper ──
    const addWorkstation = (x: number, y: number, agentId: string) => {
      entities.push({ type: 'desk', x, y });
      entities.push({ type: 'monitor', x, y, z: 20, agentId, animOffset: Math.random() * 1000 });
      entities.push({ type: 'agent_char', x: x + 1, y, agentId, animOffset: Math.random() * 1000, state: 'typing' });
    };

    // ── Orchestrator (center, prominent) ──
    addWorkstation(5, 5, 'orchestrator');

    // ── Four sub-agents ──
    addWorkstation(4, 2, 'accounts');
    addWorkstation(4, 8, 'services');
    addWorkstation(8, 2, 'reports');
    addWorkstation(8, 8, 'financials');

    // ── Server room ──
    entities.push({ type: 'server', x: 0, y: 0, animOffset: 0 });
    entities.push({ type: 'server', x: 1, y: 0, animOffset: 200 });
    entities.push({ type: 'server', x: 2, y: 0, animOffset: 400 });
    entities.push({ type: 'server', x: 0, y: 1, animOffset: 600 });
    entities.push({ type: 'server', x: 0, y: 2, animOffset: 800 });

    // ── Break area (bottom-left) ──
    entities.push({ type: 'cooler', x: 0, y: 10 });
    entities.push({ type: 'coffee', x: 1, y: 11 });
    entities.push({ type: 'plant', x: 0, y: 11 });

    // ── Meeting area (top-right) ──
    entities.push({ type: 'whiteboard', x: 11, y: 0 });
    entities.push({ type: 'desk', x: 10, y: 1 });

    // ── Decor ──
    entities.push({ type: 'plant', x: 11, y: 11 });
    entities.push({ type: 'plant', x: 3, y: 11 });
    entities.push({ type: 'plant', x: 11, y: 4 });

    // ── Standing agents at break area ──
    entities.push({ type: 'agent_char', x: 1, y: 10, agentId: 'accounts', animOffset: 0, state: 'standing' });
    entities.push({ type: 'agent_char', x: 2, y: 10, agentId: 'services', animOffset: 500, state: 'standing' });

    // ── Chat bubble state per agent ──
    // Each agent cycles through tasks on a staggered timer
    const BUBBLE_SHOW_MS = 4000;   // how long a bubble stays visible
    const BUBBLE_FADE_MS = 600;    // fade in/out duration
    const BUBBLE_GAP_MS = 2500;    // pause between bubbles
    const BUBBLE_CYCLE = BUBBLE_SHOW_MS + BUBBLE_GAP_MS;

    // Stagger each agent so bubbles don't all appear at once
    const agentIds = ['orchestrator', 'accounts', 'services', 'reports', 'financials'];
    const bubbleOffsets: Record<string, number> = {};
    agentIds.forEach((id, i) => {
      bubbleOffsets[id] = i * 1800; // 1.8s stagger between agents
    });

    let animId: number;
    let lastTime = 0;

    const render = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;

      ctx.fillStyle = '#0A0A0F';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const offsetX = canvas.width / 2;
      const offsetY = 120;

      // ── Floor ──
      for (let y = 0; y < mapSize; y++) {
        for (let x = 0; x < mapSize; x++) {
          const cx = offsetX + (x - y) * TILE_W / 2;
          const cy = offsetY + (x + y) * TILE_H / 2;

          const isServerRoom = x < 3 && y < 3;
          const isBreakArea = x < 3 && y > 9;
          const isMeeting = x > 9 && y < 3;
          const isAisle = x === 6 || x === 7;

          let color: string;
          let border: string;

          if (isServerRoom) {
            color = (x + y) % 2 === 0 ? '#1e1b4b' : '#172554';
            border = '#0f172a';
          } else if (isBreakArea) {
            color = (x + y) % 2 === 0 ? '#1c1917' : '#292524';
            border = '#0c0a09';
          } else if (isMeeting) {
            color = (x + y) % 2 === 0 ? '#1e293b' : '#0f172a';
            border = '#0c1524';
          } else if (isAisle) {
            color = (x + y) % 2 === 0 ? '#312e81' : '#1e1b4b';
            border = '#0f0e3b';
          } else {
            color = (x + y) % 2 === 0 ? '#1e1e2e' : '#181825';
          }

          drawIsoTile(ctx, cx, cy, color, border || '#12121a');
        }
      }

      // ── Sort entities by isometric depth ──
      const sorted = [...entities].sort((a, b) => {
        const da = a.x + a.y + (a.z || 0) * 0.01;
        const db = b.x + b.y + (b.z || 0) * 0.01;
        return da - db;
      });

      // Track agent positions for connection lines
      const agentPositions: Record<string, { cx: number; cy: number }> = {};

      for (const ent of sorted) {
        const cx = offsetX + (ent.x - ent.y) * TILE_W / 2;
        const cy = offsetY + (ent.x + ent.y) * TILE_H / 2 - (ent.z || 0);

        switch (ent.type) {
          case 'wall_left':
          case 'wall_right':
          case 'wall_corner': {
            const isWindow = (ent.y % 3 === 0 || ent.x % 3 === 0) && (ent.x > 0 || ent.y > 0);
            const isLeft = ent.type === 'wall_left';
            if (isWindow && ent.type !== 'wall_corner') {
              drawWallWithWindow(ctx, cx, cy, 90, '#1e1e2e', '#181825', '#141420', isLeft);
            } else {
              drawIsoBlock(ctx, cx, cy, 90, '#1e1e2e', '#181825', '#141420');
            }
            break;
          }
          case 'wall_inner':
            drawIsoBlock(ctx, cx, cy, 70, '#252540', '#1e1e35', '#18182a');
            break;
          case 'desk':
            drawShadow(ctx, cx, cy, 24);
            drawIsoBlock(ctx, cx, cy, 18, '#3d2e5c', '#2d1f4a', '#4c3870');
            break;
          case 'monitor': {
            const agent = AGENTS[ent.agentId || 'orchestrator'];
            const blink = Math.floor((time + (ent.animOffset || 0)) / 800) % 2 === 0;
            const sprite = blink ? monitorBlinkSprite(agent.glow) : monitorSprite(agent.glow);
            drawSprite(ctx, cx, cy, sprite, 3);
            break;
          }
          case 'agent_char': {
            const agent = AGENTS[ent.agentId || 'orchestrator'];
            drawShadow(ctx, cx, cy, 12);

            // Store position for typing agents (workstation agents)
            if (ent.state === 'typing') {
              agentPositions[ent.agentId || ''] = { cx, cy };
            }

            if (ent.state === 'typing') {
              const frame = Math.floor((time + (ent.animOffset || 0)) / 200) % 2 === 0;
              drawSprite(ctx, cx, cy, frame ? charTyping1(agent.fur, agent.body) : charTyping2(agent.fur, agent.body), 3);
            } else {
              drawSprite(ctx, cx, cy, charStanding(agent.fur, agent.body), 3);
            }

            // Draw label for typing agents
            if (ent.state === 'typing') {
              drawLabel(ctx, cx, cy + 18, agent.label, PALETTE[agent.fur]);
            }
            break;
          }
          case 'server': {
            drawShadow(ctx, cx, cy, 18);
            const blink = Math.floor((time + (ent.animOffset || 0)) / 400) % 2 === 0;
            drawSprite(ctx, cx, cy, blink ? serverBlinkSprite : serverSprite, 4);
            break;
          }
          case 'plant':
            drawShadow(ctx, cx, cy, 14);
            drawSprite(ctx, cx, cy, plantSprite, 3.5);
            break;
          case 'cooler':
            drawShadow(ctx, cx, cy, 14);
            drawSprite(ctx, cx, cy, coolerSprite, 3.5);
            break;
          case 'coffee':
            drawShadow(ctx, cx, cy, 14);
            drawSprite(ctx, cx, cy, coffeeSprite, 3.5);
            break;
          case 'whiteboard':
            drawShadow(ctx, cx, cy, 18);
            drawSprite(ctx, cx, cy, whiteboardSprite, 4);
            break;
        }
      }

      // ── Chat bubbles (drawn on top of everything) ──
      for (const agentId of agentIds) {
        const pos = agentPositions[agentId];
        if (!pos) continue;

        const liveTask = currentTasks?.[agentId];
        const tasks = liveTask ? [liveTask] : AGENT_TASKS[agentId];
        const offset = bubbleOffsets[agentId];
        const t = (time + offset) % (BUBBLE_CYCLE * tasks.length);
        const cyclePos = t % BUBBLE_CYCLE;
        const taskIdx = Math.floor(t / BUBBLE_CYCLE) % tasks.length;

        if (cyclePos < BUBBLE_SHOW_MS) {
          // Calculate opacity for fade in/out
          let opacity = 1;
          if (cyclePos < BUBBLE_FADE_MS) {
            opacity = cyclePos / BUBBLE_FADE_MS;
          } else if (cyclePos > BUBBLE_SHOW_MS - BUBBLE_FADE_MS) {
            opacity = (BUBBLE_SHOW_MS - cyclePos) / BUBBLE_FADE_MS;
          }

          // Slight float animation
          const floatY = Math.sin(cyclePos * 0.003) * 2;

          const agent = AGENTS[agentId];
          const accentColor = PALETTE[agent.fur];
          drawChatBubble(
            ctx,
            pos.cx,
            pos.cy - 42 + floatY,
            tasks[taskIdx],
            accentColor,
            Math.max(0, Math.min(1, opacity)),
          );
        }
      }

      // ── Connection lines from orchestrator to sub-agents ──
      const orch = agentPositions['orchestrator'];
      if (orch) {
        for (const id of ['accounts', 'services', 'reports', 'financials']) {
          const pos = agentPositions[id];
          if (pos) {
            drawConnectionLine(ctx, orch.cx, orch.cy, pos.cx, pos.cy, '#a855f7', time);
          }
        }
      }

      // ── Ambient particles (data flow) ──
      for (let i = 0; i < 6; i++) {
        const t = (time * 0.001 + i * 1.2) % 8;
        const px = offsetX + Math.sin(t * 0.8) * 200;
        const py = offsetY + t * 50;
        const alpha = Math.sin(t * Math.PI / 8) * 0.4;
        if (alpha > 0) {
          ctx.fillStyle = `rgba(168, 85, 247, ${alpha})`;
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="bg-[#0c0c18] border-2 border-[#1a1a30] rounded-xl p-5 sm:p-6 shadow-[0_0_30px_rgba(124,58,237,0.08)] mb-8 overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-purple-300 tracking-wide uppercase">Agency HQ — Live View</h3>
          <p className="text-xs text-zinc-500 mt-0.5 font-mono">ISOMETRIC OPS FEED // REAL-TIME</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#12121f] border border-[#2a2a45]">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
          <span className="text-[10px] text-zinc-400 font-mono uppercase">Live</span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative bg-[#08080f] rounded-lg border border-[#1a1a2e] overflow-hidden">
        <canvas
          ref={canvasRef}
          width={1024}
          height={560}
          className="w-full h-auto"
          style={{ imageRendering: 'pixelated' }}
        />

        {/* Scanline overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'repeating-linear-gradient(to bottom, rgba(124,58,237,0.03) 0px, rgba(124,58,237,0.03) 2px, transparent 2px, transparent 4px)',
            mixBlendMode: 'screen',
          }}
        />

        {/* Status bar */}
        <div className="absolute left-3 right-3 bottom-3 flex items-center justify-between gap-2 px-4 py-2.5 rounded-md bg-[#0f0f1e]/90 border border-[#2a2a45] backdrop-blur-sm">
          <span className="text-[10px] text-purple-300 font-mono uppercase tracking-wider">
            AI OPS // {activeAgentCount} agents online
          </span>
          <span className="text-[10px] text-purple-400 font-mono uppercase animate-pulse">
            ● Systems Nominal
          </span>
        </div>
      </div>
    </div>
  );
}
