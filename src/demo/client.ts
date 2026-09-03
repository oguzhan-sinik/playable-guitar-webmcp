/// <reference lib="dom" />
/**
 * Demo UI. Renders shared app state; manual interactions and WebMCP tool
 * calls both go through the same actions in webmcp/tool-context.ts.
 */
import { initWebMcp, TOOL_COUNT } from '../webmcp/register-tools.js';
import {
  state,
  setState,
  onStateChange,
  compileVersion,
  analyzeSong,
  explainVersion,
  chooseSection,
  createPlan,
  setPlayerLevel,
  loadSongLink,
  setPlayerProfile,
  configurePractice,
  preparePracticePreview,
  beginSongResearch,
  fetchResearchStatus,
  submitSongEvidence,
  resolveResearchedSong,
  type SkillLevel,
} from '../webmcp/tool-context.js';
import { onActivity, onToolInvocation } from '../webmcp/tool-events.js';
import { playPreview, stopPreview, playLooped, onCurrentChord } from '../webmcp/studio-playback.js';
import { chordDiagramSvg } from '../presentation/guitar/chord-diagram-svg.js';
import { chordDiagramFor } from '../presentation/guitar/chord-diagram.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const fmt = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const pct = (before: number, after: number): number =>
  before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;

const diagramSvg = (name: string, capo: number): string => {
  const shape = chordDiagramFor(name, capo);
  return shape !== undefined
    ? chordDiagramSvg(shape, { width: 86, height: 122 })
    : `<div class="muted" style="width:86px">${name}</div>`;
};

function render(): void {
  $('webmcpStatus').textContent =
    state.webmcp === 'connected'
      ? `WebMCP Connected · ${TOOL_COUNT} tools`
      : state.webmcp === 'error'
        ? 'WebMCP registration failed'
        : 'WebMCP unavailable in this browser';

  document.querySelectorAll<HTMLButtonElement>('.levels button[data-level]').forEach((b) => {
    b.classList.toggle('active', b.dataset.level === state.level);
  });
  $('barre').classList.toggle('active', state.avoidBarreChords);

  $('songTitle').textContent = state.title.length > 0 ? state.title : state.songId;

  const a = state.analysis;
  const researchableSource = state.loadedSource !== null && state.loadedSource.capability === 'RESEARCHABLE';
  $('analysis').innerHTML = a
    ? `<div class="facts">
        <div><span>${Math.round(a.tempoBpm)} BPM</span><label>Tempo</label></div>
        <div><span>${a.meter}</span><label>Meter</label></div>
        <div><span>${a.key ?? '—'}</span><label>Key</label></div>
        <div><span>${Math.round(a.confidence * 100)}%</span><label>Confidence</label></div>
      </div>
      <div class="chords">${a.harmony.mainChords.map((c) => `<span class="song-chord">${c}</span>`).join(' · ')}</div>`
    : researchableSource
      ? `<div class="notice">We found the song.<br />
          This source doesn't expose analyzable audio, so your agent researches its musical structure from independent public sources.<br />
          <span class="muted">Researching key, tempo, meter, harmony and sections…</span></div>`
      : '<span class="muted">Not analyzed yet</span>';

  // actions that need an analyzable song are disabled while the page shows a
  // recognized-but-unanalyzable source
  const analyzable = a !== null;
  for (const id of ['compile', 'analyze', 'explain', 'planAdd']) {
    const btn = $(id) as HTMLButtonElement;
    btn.disabled = !analyzable;
    btn.title = analyzable ? '' : 'Load an analyzable link (YouTube or direct audio) first.';
  }

  $('sections').innerHTML = state.sections
    .map((s) => {
      const active = state.currentSection === s;
      return `<button type="button" class="chip ${active ? 'sel' : ''}" data-section="${s.type}" data-index="${s.index}">
        ${s.type}${s.endMs > s.startMs ? ` <span class="muted">${fmt(s.startMs)}–${fmt(s.endMs)}</span>` : ''}
      </button>`;
    })
    .join('');

  const r = state.arrangement;
  $('versionCard').classList.toggle('hidden', r === null);
  $('ladderCard').classList.toggle('hidden', r === null);
  $('mappingCard').classList.toggle('hidden', r === null || r.mapping.length === 0);
  $('studioCard').classList.toggle('hidden', r === null);
  if (r !== null) {
    $('levelLabel').textContent = `${r.level} VERSION`;
    $('capo').textContent = r.capo > 0 ? `Capo ${r.capo}` : 'No capo';
    $('chords').innerHTML = r.chords.map((c) => `<span class="chord-chip" data-chord="${c}">${c}</span>`).join(' ');
    $('metrics').innerHTML =
      `Arrangement fidelity ${Math.round(r.fidelity * 100)}% · Tempo ${Math.round(r.tempoBpm)} BPM` +
      (r.sourceConfidence !== undefined
        ? ` · Song understanding ${Math.round(r.sourceConfidence.harmonyConfidence * 100)}%`
        : '') +
      (r.barreChordCount > 0 ? ` · ${r.barreChordCount} barre chord${r.barreChordCount > 1 ? 's' : ''}` : ' · no barre chords');
    const reduction = pct(r.difficultyBefore, r.difficultyAfter);
    const playerReduction =
      r.playerDifficulty !== undefined && r.difficultyBefore > 0
        ? pct(r.difficultyBefore, r.playerDifficulty)
        : null;
    $('bars').innerHTML = `
      <div class="bar-row"><span>Original</span><div class="bar"><span style="width:${Math.min(100, r.difficultyBefore * 10)}%"></span></div><span>${r.difficultyBefore.toFixed(2)} / 10</span></div>
      <div class="bar-row"><span>Your version</span><div class="bar"><span style="width:${Math.min(100, r.difficultyAfter * 10)}%"></span></div><span>${r.difficultyAfter.toFixed(2)} / 10</span></div>
      ${r.playerDifficulty !== undefined ? `<div class="bar-row"><span>For you</span><div class="bar"><span style="width:${Math.min(100, r.playerDifficulty * 10)}%"></span></div><span>${r.playerDifficulty.toFixed(2)} / 10</span></div>` : ''}
      ${playerReduction !== null && playerReduction > 0 ? `<div class="reduction">↓ ${playerReduction}% easier for you</div>` : reduction > 0 ? `<div class="reduction">↓ ${reduction}% easier</div>` : ''}`;
    $('ladder').innerHTML = r.ladder
      .map(
        (e) => `<div class="ladder-item ${e.level === state.level ? 'sel' : ''}" data-level="${e.level}">
        <strong>${e.level}</strong> · ${e.capo > 0 ? `Capo ${e.capo} · ` : ''}for you ${e.playerDifficulty !== undefined ? e.playerDifficulty.toFixed(2) : e.difficulty.toFixed(2)} · F ${Math.round(e.fidelity * 100)}%
        <div class="muted">${e.chords.join(' · ')}</div>
      </div>`,
      )
      .join('');
    $('mapping').innerHTML =
      r.mapping
        .map((m) => `<div><span class="played">${m.played}</span> <span class="arrow">→</span> ${m.sounding}</div>`)
        .join('') + (r.capo > 0 ? `<div class="muted">Capo ${r.capo}</div>` : '');

    renderStudio();
  }

  const why = state.explanation;
  $('whyCard').classList.toggle('hidden', why === null);
  if (why !== null) {
    $('why').innerHTML = why.changes.map((c) => `<li>${c}</li>`).join('');
  }

  $('sectionCard').classList.toggle('flash', state.currentSection !== null);
  if (state.currentSection !== null && state.currentSection.endMs > 0) {
    $('sectionDetail').innerHTML = `<strong>${state.currentSection.type}</strong> ${fmt(state.currentSection.startMs)} → ${fmt(state.currentSection.endMs)} — learn this section first`;
  }

  const plan = state.plan;
  $('planCard').classList.toggle('hidden', plan === null);
  if (plan !== null) {
    $('plan').innerHTML = plan.steps.map((s) => `<li>${s.instruction}</li>`).join('');
  }

  const session = state.session;
  $('sessionCard').classList.toggle('hidden', session === null);
  if (session !== null) {
    $('sessionSteps').innerHTML = session.steps
      .map((s) => `<li>${s.instruction} <span class="muted">· ${s.minutes} min</span></li>`)
      .join('');
  }

  // loaded-from-link source card (identity + metadata only — no playback)
  const src = state.loadedSource;
  $('sourceCard').classList.toggle('hidden', src === null);
  if (src !== null) {
    $('sourceTitle').textContent = src.title ?? state.title;
    const art = $('sourceArt') as HTMLImageElement;
    if (src.artworkUrl !== undefined && src.artworkUrl.length > 0) {
      art.src = src.artworkUrl;
      art.classList.remove('hidden');
    } else {
      art.classList.add('hidden');
    }
    $('sourceNote').textContent =
      src.capability === 'RESEARCHABLE'
        ? `Song recognized · ${src.provider.toLowerCase()} source · agent research available`
        : src.capability === 'PLAYBACK_ONLY'
          ? `Song recognized · ${src.provider.toLowerCase()} source · analysis source unavailable`
          : src.cached === true
            ? 'Loaded from cache'
            : '';
  }
  if (state.loadStatus === 'loading') $('loadStatus').textContent = 'Loading song…';

  renderResearch();
}

/** Live agent-research evidence board (real values only). */
function renderResearch(): void {
  const r = state.research;
  const show = r !== null && typeof r.status === 'string';
  $('researchCard').classList.toggle('hidden', !show);
  if (!show || r === null) return;

  const cls = (v: number): string => (v >= 0.8 ? 'ok' : v >= 0.6 ? 'warn' : v > 0 ? 'bad' : 'miss');
  const row = (label: string, value: string, conf: number, note = ''): string => `
    <div class="res-row">
      <div class="res-head"><strong>${label}</strong><span class="${cls(conf)}">${conf > 0 ? `${Math.round(conf * 100)}%${note !== '' ? ` · ${note}` : ''}` : 'waiting for research'}</span></div>
      <div class="res-value ${cls(conf)}">${value}</div>
      <div class="bar"><span style="width:${Math.round(conf * 100)}%"></span></div>
    </div>`;

  const res = r.resolved;
  const c = r.confidence;
  const identity = r.identity;
  const mb = r.musicBrainz;
  const identityValue = [identity?.artist, identity?.title].filter(Boolean).join(' — ');
  const identityNote = [
    state.loadedSource !== null && state.loadedSource.provider === 'SPOTIFY' ? 'Spotify' : null,
    mb !== undefined && mb !== null ? 'MusicBrainz' : null,
  ].filter(Boolean).join(' ✓ ');

  const conflictBoxes = (r.conflicts ?? [])
    .map(
      (cf) => `<div class="conflict-box ${cf.field === 'tempo' && res?.tempoExplanation !== undefined ? 'resolved-box' : ''}">
        <strong>${cf.field.startsWith('harmony') ? `HARMONY · ${cf.field.split(':')[1] ?? ''}` : cf.field.toUpperCase()}</strong><br />
        ${cf.readings.map((rd) => `<span class="muted">${String(rd)}</span>`).join(' <strong>vs</strong> ')}
        ${cf.field === 'tempo' && res?.tempoExplanation !== undefined ? `<br /><span class="ok">${res.tempoExplanation}</span>` : `<br /><span class="muted">Checking capo / metrical context…</span>`}
      </div>`,
    )
    .join('');

  const sources: Array<{ domain: string; url: string }> = (r.evidence ?? [])
    .filter((ev) => ev.url.startsWith('http'))
    .map((ev) => ({ domain: ev.domain, url: ev.url }))
    .filter((s, i, arr) => arr.findIndex((x) => x.domain === s.domain) === i);

  const overall = Math.round((c?.overallUsability ?? 0) * 100);
  const ready = r.status === 'READY' || r.status === 'READY_WITH_WARNINGS';
  $('researchBoard').innerHTML = `
    <div class="res-row"><div class="res-head"><strong>IDENTITY</strong><span class="ok">${cls(c?.identity ?? 0) === 'miss' ? 'identifying…' : `${Math.round((c?.identity ?? 0) * 100)}%`}</span></div>
      <div class="res-value">${identityValue || '—'}</div>
      ${identityNote !== '' ? `<div class="src-chip">${identityNote} ✓</div>` : ''}</div>
    ${row('KEY', res?.key ?? '—', c?.key ?? 0)}
    ${row('TEMPO', res?.tempoBpm !== undefined ? `${res.tempoBpm} BPM` : '—', c?.tempo ?? 0, res?.tempoExplanation !== undefined ? 'metrical levels merged' : '')}
    ${row('METER', res?.meter ?? '—', c?.meter ?? 0)}
    ${row('HARMONY', (res?.mainChords ?? []).length > 0 ? res!.mainChords.join(' · ') : '—', c?.harmony ?? 0, (r.independentDomains ?? 0) > 1 ? `${r.independentDomains} independent sources` : '')}
    ${row('STRUCTURE', (res?.sectionOrder ?? []).length > 0 ? res!.sectionOrder.join(' · ') : '—', c?.structure ?? 0)}
    ${conflictBoxes}
    <div class="res-row"><div class="res-head"><span>Sources checked</span><span>${r.sources ?? 0} · ${r.independentDomains ?? 0} independent</span></div>
      <div>${sources.map((s) => `<a class="src-chip" href="${s.url}" target="_blank" rel="noreferrer">${s.domain}</a>`).join('')}</div></div>
    <div class="overall">SONG UNDERSTANDING <span class="${cls(c?.overallUsability ?? 0)}">${overall}%</span></div>
    <div class="bar" style="margin-top:.3rem"><span style="width:${overall}%"></span></div>
    <div style="margin-top:.6rem; display:flex; gap:.5rem; flex-wrap:wrap">
      ${ready ? `<span class="ok" style="font-weight:700">${r.status === 'READY' ? 'READY TO COMPILE' : 'READY WITH WARNINGS'}</span>` : '<span class="muted">Waiting for research — the agent keeps submitting evidence…</span>'}
      <button type="button" class="go secondary" data-action="research-again" style="margin-left:auto; padding:.4rem .7rem; font-size:.8rem">Research again</button>
    </div>
    ${(r.warnings ?? []).length > 0 ? `<div class="ev-list">${r.warnings!.map((w) => `⚠ ${w}`).join('<br />')}</div>` : ''}
    <div class="ev-list">${(r.evidence ?? []).map((ev) => `${ev.claimType}: ${ev.value} — ${ev.domain}`).join('<br />')}</div>`;
  $('researchHint').textContent =
    r.status === 'NEEDS_MORE_EVIDENCE' || r.status === 'RESEARCHING'
      ? (r.suggestedQueries ?? []).slice(0, 3).join(' · ')
      : '';
}

/** The Practice Studio panel: diagrams + timeline + transport. */
function renderStudio(): void {
  const r = state.arrangement;
  if (r === null) return;
  const p = state.practice;
  const sectionName = state.currentSection?.type ?? p.section ?? 'SONG';
  const sectionOnly = state.analysis?.timingPrecision === 'SECTION_ONLY';
  $('studioTitle').textContent = sectionOnly ? `PRACTICE STUDIO · Practice progression${sectionName !== 'SONG' ? ` · ${sectionName}` : ''}` : `PRACTICE STUDIO · ${sectionName}`;
  $('studioSub').innerHTML =
    `${r.level.toLowerCase()} · ${r.capo > 0 ? `capo ${r.capo} · ` : ''}difficulty for you ${r.playerDifficulty !== undefined ? r.playerDifficulty.toFixed(1) : r.difficultyAfter.toFixed(1)} · fidelity ${Math.round(r.fidelity * 100)}% · tempo ${Math.round((p.tempoFactor) * 100)}%` +
    (sectionOnly ? ' · <span class="warn">section timing approximate</span>' : '');

  const uniqueChords = [...new Set(r.chords)].slice(0, 6);
  $('studioChords').innerHTML = uniqueChords
    .map((c) => `<div class="chord-slot" data-chord-slot="${c}" title="${c} — click to enlarge">${diagramSvg(c, r.capo)}</div>`)
    .join('');

  // simple progression timeline: one segment per chord slot
  $('studioTimeline').innerHTML = uniqueChords
    .map((c) => `<div class="tl-seg" data-tl="${c}" style="flex:${Math.max(1, uniqueChords.length)}"></div>`)
    .join('');

  ($('tempoSlider') as HTMLInputElement).value = String(Math.round(p.tempoFactor * 100));
  $('tempoLabel').textContent = `${Math.round(p.tempoFactor * 100)}%`;
  $('studioLoop').classList.toggle('active', p.loop);
  $('studioMetronome').classList.toggle('active', p.metronome);
  document.querySelectorAll<HTMLButtonElement>('button[data-countin]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.countin) === p.countInBars);
  });

  const preview = state.preview;
  $('studioPlay').textContent = preview !== null && preview.ready ? `▶ Play ${sectionName.toLowerCase()} (${preview.durationSec.toFixed(0)}s)` : '▶ Prepare & Play';
  $('studioStatus').textContent =
    preview !== null && preview.ready
      ? `Preview ready — ${preview.chords.join(' ')}`
      : 'Preview not prepared yet — press Prepare & Play.';
}

let highlightedChord: string | null = null;
function highlightChord(chord: string | null): void {
  highlightedChord = chord;
  document.querySelectorAll<HTMLElement>('.chord-slot').forEach((el) => {
    el.classList.toggle('current', el.dataset.chordSlot === chord);
  });
  document.querySelectorAll<HTMLElement>('.tl-seg').forEach((el) => {
    el.classList.toggle('playing', el.dataset.tl === chord);
  });
  $('nowChord').textContent =
    chord !== null && state.arrangement !== null
      ? `Now: ${chord}${state.arrangement.capo > 0 ? ` (capo ${state.arrangement.capo})` : ''}`
      : '';
}

function bindLinkInput(): void {
  const load = async (): Promise<void> => {
    const url = ($('songUrl') as HTMLInputElement).value.trim();
    if (url.length === 0) return;
    const btn = $('learn') as HTMLButtonElement;
    const originalLabel = btn.textContent ?? 'Learn This Song';
    btn.disabled = true;
    btn.textContent = 'Recognizing song…';
    $('loadStatus').textContent = 'Looking up the song…';
    try {
      const result = await loadSongLink(url, { rightsConfirmed: ($('rightsConfirm') as HTMLInputElement).checked });
      if (result.researchAvailable === true) {
        // the page itself kicks off the agent research session so the human
        // SEES it working: identity resolves, the evidence board fills live
        btn.textContent = 'Starting agent research…';
        $('loadStatus').textContent = 'Song recognized — your agent is starting research…';
        try {
          const research = await beginSongResearch({
            ...(result.title !== undefined && result.title.length > 0 && { title: result.title }),
            ...(result.artist !== undefined && result.artist.length > 0 && { artist: result.artist }),
          });
          $('loadStatus').textContent =
            research.musicBrainz !== undefined && research.musicBrainz !== null
              ? `Research started — recording identified as “${research.identity?.artist ?? ''} · ${research.identity?.title ?? ''}”. The agent now gathers evidence from public sources.`
              : 'Research started — no recording match yet. Your agent should confirm the artist and gather evidence from public sources.';
        } catch (e) {
          $('loadStatus').textContent = `Research could not start: ${err(e)}`;
        }
      } else {
        $('loadStatus').textContent = 'Song loaded';
      }
    } catch (e) {
      const message = err(e);
      $('loadStatus').textContent = message.includes('permission or other lawful authorization')
        ? 'Almost there: tick the permission checkbox under the link field, then click Learn again.'
        : `Error: ${message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  };
  $('learn').addEventListener('click', () => void load());
  $('songUrl').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') void load();
  });
}

function bindManualControls(): void {
  document.querySelectorAll<HTMLButtonElement>('.levels button[data-level]').forEach((b) => {
    b.addEventListener('click', () => setPlayerLevel(b.dataset.level as SkillLevel));
  });
  $('barre').addEventListener('click', () => {
    state.avoidBarreChords = !state.avoidBarreChords;
    setPlayerProfile({ practicePreferences: { avoidBarreChords: state.avoidBarreChords } });
    render();
  });
  $('compile').addEventListener('click', () => {
    void compileVersion(state.level).catch((e) => ($('status').textContent = `Error: ${err(e)}`));
  });
  $('analyze').addEventListener('click', () => {
    void analyzeSong().catch((e) => ($('status').textContent = `Error: ${err(e)}`));
  });
  $('explain').addEventListener('click', () => {
    void explainVersion().catch((e) => ($('status').textContent = `Error: ${err(e)}`));
  });
  $('planAdd').addEventListener('click', () => {
    void createPlan(20).catch((e) => ($('status').textContent = `Error: ${err(e)}`));
  });
  $('sections').addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('.chip');
    if (btn !== null) chooseSection(btn.dataset.section!);
  });
  $('researchCard').addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('[data-action="research-again"]') === null) return;
    const identity = state.research?.identity;
    const title = state.loadedSource?.title ?? identity?.title;
    void beginSongResearch({
      refresh: true,
      ...(title !== undefined && { title }),
      ...(identity?.artist !== undefined && identity.artist.length > 0 && { artist: identity.artist }),
    }).catch((e) => ($('researchHint').textContent = `Error: ${err(e)}`));
  });
  $('ladder').addEventListener('click', (ev) => {
    const item = (ev.target as HTMLElement).closest<HTMLElement>('.ladder-item');
    if (item !== null) void compileVersion(item.dataset.level as SkillLevel);
  });
  // click a chord anywhere → highlight its diagram in the studio
  document.body.addEventListener('click', (ev) => {
    const chip = (ev.target as HTMLElement).closest<HTMLElement>('[data-chord]');
    if (chip !== null) {
      highlightChord(chip.dataset.chord!);
      $('studioCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  $('studioChords').addEventListener('click', (ev) => {
    const slot = (ev.target as HTMLElement).closest<HTMLElement>('.chord-slot');
    if (slot !== null) highlightChord(slot.dataset.chordSlot!);
  });

  // studio transport
  $('studioPlay').addEventListener('click', async () => {
    try {
      if (state.preview === null || !state.preview.ready) {
        $('studioStatus').textContent = 'Preparing preview…';
        await preparePracticePreview();
        render();
      }
      if (state.practice.loop) await playLooped();
      else await playPreview();
    } catch (e) {
      $('studioStatus').textContent = `Error: ${err(e)}`;
    }
  });
  $('studioStop').addEventListener('click', () => stopPreview());
  $('studioLoop').addEventListener('click', () => {
    configurePractice({ loop: !state.practice.loop });
    render();
  });
  $('studioMetronome').addEventListener('click', () => {
    configurePractice({ metronome: !state.practice.metronome });
    render();
  });
  $('tempoSlider').addEventListener('input', () => {
    $('tempoLabel').textContent = `${($('tempoSlider') as HTMLInputElement).value}%`;
  });
  $('tempoSlider').addEventListener('change', () => {
    configurePractice({ tempoFactor: Number(($('tempoSlider') as HTMLInputElement).value) / 100 });
    render();
  });
  document.querySelectorAll<HTMLButtonElement>('button[data-countin]').forEach((b) => {
    b.addEventListener('click', () => {
      configurePractice({ countInBars: Number(b.dataset.countin) });
      render();
    });
  });
  $('studioPrepare').addEventListener('click', async () => {
    try {
      $('studioStatus').textContent = 'Preparing preview…';
      await preparePracticePreview();
      render();
    } catch (e) {
      $('studioStatus').textContent = `Error: ${err(e)}`;
    }
  });
}

let activityCount = 0;
function bindActivityFeed(): void {
  onActivity((message) => {
    $('agentFeed').classList.remove('hidden');
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.textContent = message;
    $('agentFeed').prepend(item);
    activityCount += 1;
    if (activityCount > 5) $('agentFeed').lastElementChild?.remove();
  });
}

/** Hidden dev overlay: ?debug=webmcp */
function bindDebugOverlay(): void {
  if (new URLSearchParams(location.search).get('debug') !== 'webmcp') return;
  const el = $('webmcpDebug');
  el.classList.remove('hidden');
  const update = (line?: string): void => {
    el.textContent =
      `WebMCP: ${state.webmcp} · tools registered: ${TOOL_COUNT}` +
      (line !== undefined ? ` · last: ${line}` : '');
  };
  update();
  onToolInvocation((invocation) => update(`${invocation.tool} · ${invocation.durationMs}ms`));
}

async function main(): Promise<void> {
  render();
  bindManualControls();
  bindActivityFeed();
  bindLinkInput();
  bindDebugOverlay();
  onStateChange(render);
  onCurrentChord(highlightChord);
  state.webmcp = await initWebMcp();
  render();
  // headless-test hook: drive the shared actions the WebMCP tools use
  (window as unknown as { __playableDebug: unknown }).__playableDebug = {
    state,
    loadSongLink,
    beginSongResearch,
    submitSongEvidence,
    resolveResearchedSong,
    compileVersion,
  };
}

void main();
