/* Playback controller shared by every concept: step, back, play, scrub, speed.
   A view gives it a list of "stops" (frame indices) and gets told which frame to draw. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, icon, clamp } = NS.util;

  // Player: the shared transport bar (first / back / play / next / last, scrubber, speed).
  // A view hands it a list of `stops` (each stop is a frame index) and an onChange callback.
  // The player owns only *which* frame is current; the view decides how to draw it. That keeps every
  // concept's playback behaviour identical.
  class Player {
    // opts.label names the unit in the readout ("Step", "Move", "Event"); opts.onChange(frame, pos) draws.
    constructor(host, opts) {
      // State: stops = frame indices the player can visit, pos = index into stops,
      // speed = playback multiplier, timer = setInterval handle while playing.
      this.opts = opts || {};
      this.stops = [0];
      this.pos = 0;
      this.speed = 1;
      this.timer = null;
      this.build(host);
    }

    // build(host): create the buttons, scrubber, readout and speed menu, and attach them to host.
    build(host) {
      // Small factory for the round icon buttons; every one gets a title and aria-label for accessibility.
      const btn = (name, label, fn, cls) =>
        el('button', { type: 'button', class: 'pbtn ' + (cls || ''), title: label, 'aria-label': label, onclick: fn }, icon(name, 18));

      this.bFirst = btn('first', 'Back to start (Home)', () => this.seek(0));
      this.bPrev = btn('prev', 'Step back (←)', () => this.step(-1));
      this.bPlay = btn('play', 'Play (Space)', () => this.toggle(), 'is-main');
      this.bNext = btn('next', 'Step forward (→)', () => this.step(1));
      this.bLast = btn('last', 'Jump to the end (End)', () => this.seek(this.stops.length - 1));

      this.range = el('input', {
        type: 'range', min: 0, max: 0, value: 0, class: 'scrub', 'aria-label': 'Step position',
        oninput: (e) => { this.pause(); this.seek(+e.target.value); }
      });
      this.readout = el('span', { class: 'readout mono', 'aria-live': 'polite' });
      this.speedSel = el('select', {
        class: 'speed', 'aria-label': 'Playback speed',
        onchange: (e) => { this.speed = +e.target.value; if (this.timer) { this.pause(); this.play(); } }
      }, [0.5, 1, 2, 4].map((v) => el('option', { value: v, selected: v === 1 }, v + '×')));

      this.root = el('div', { class: 'player' },
        el('div', { class: 'pbtns' }, this.bFirst, this.bPrev, this.bPlay, this.bNext, this.bLast),
        this.range,
        el('div', { class: 'pmeta' }, this.readout, this.speedSel));
      host.appendChild(this.root);
    }

    // The frame index the view should currently show.
    get frame() { return this.stops[this.pos]; }

    // setStops(stops, pos): called by a view whenever it recomputes its simulation.
    // Pauses playback, installs the new stops, keeps the viewer's position when possible (clamped).
    setStops(stops, pos) {
      this.pause();
      this.stops = stops.length ? stops : [0];
      this.pos = clamp(pos == null ? 0 : pos, 0, this.stops.length - 1);
      this.range.max = this.stops.length - 1;
      this.sync();
    }

    // seek(p): jump to stop number p (clamped), then redraw via sync().
    seek(p) { this.pos = clamp(p, 0, this.stops.length - 1); this.sync(); }

    // step(d): move by d stops (+1 / -1). Manual stepping always pauses autoplay.
    step(d) { this.pause(); this.seek(this.pos + d); }

    // toggle(): Space-bar behaviour: play if paused, pause if playing.
    toggle() { this.timer ? this.pause() : this.play(); }

    // play(): restart from the beginning if we are at the end, then advance one stop per tick.
    // The tick length is 950ms divided by the speed multiplier.
    play() {
      if (this.pos >= this.stops.length - 1) this.seek(0);
      this.timer = setInterval(() => {
        if (this.pos >= this.stops.length - 1) { this.pause(); return; }
        this.seek(this.pos + 1);
        if (this.pos >= this.stops.length - 1) this.pause();
      }, 950 / this.speed);
      this.paintPlay();
    }

    pause() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.paintPlay();
    }

    // paintPlay(): swap the play / pause icon and update its tooltip and accessible name.
    paintPlay() {
      const playing = !!this.timer;
      this.bPlay.replaceChildren(icon(playing ? 'pause' : 'play', 18));
      this.bPlay.title = playing ? 'Pause (Space)' : 'Play (Space)';
      this.bPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }

    // sync(): the single place that refreshes the UI after the position changes:
    // scrubber value, disabled state of the end buttons, readout text, and the view's onChange.
    sync() {
      const last = this.stops.length - 1;
      this.range.value = this.pos;
      this.bFirst.disabled = this.bPrev.disabled = this.pos === 0;
      this.bNext.disabled = this.bLast.disabled = this.pos === last;
      this.readout.textContent = (this.opts.label || 'Step') + ' ' + this.pos + ' / ' + last;
      if (this.opts.onChange) this.opts.onChange(this.frame, this.pos);
    }
  }

  // Only one concept is visible at a time; app.js sets Player.current when a view is activated.
  // Shortcuts are ignored while typing in a field, and Space is left alone on a focused button.
  // Keyboard shortcuts go to whichever player is on screen.
  Player.current = null;
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
      const p = Player.current;
      if (!p || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (t && t.tagName === 'BUTTON' && e.key === ' ') return; // let a focused button handle Space itself
      if (e.key === 'ArrowRight') { p.step(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { p.step(-1); e.preventDefault(); }
      else if (e.key === ' ') { p.toggle(); e.preventDefault(); }
      else if (e.key === 'Home') { p.pause(); p.seek(0); e.preventDefault(); }
      else if (e.key === 'End') { p.pause(); p.seek(p.stops.length - 1); e.preventDefault(); }
    });
  }

  NS.Player = Player;
})(typeof window !== 'undefined' ? window : globalThis);
