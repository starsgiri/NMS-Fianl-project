import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

const API = 'http://localhost:8080/api';

interface Incident { root_cause: string; impacted: string[]; alarms_received: number; alarms_suppressed: number; ts: string; }
interface Alarm { source: string; device: string; state: string; type: string; ts: number; }

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <header><h1>NMS Root Cause Analysis</h1><span>Nagios · SNMP · Kafka</span></header>

    <section class="stats">
      <div class="card"><b>{{ alarms().length }}</b><small>raw alarms received</small></div>
      <div class="card"><b>{{ roots().length }}</b><small>active root causes</small></div>
      <div class="card"><b>{{ suppressed() }}</b><small>symptoms suppressed</small></div>
    </section>

    <main>
      <section class="panel">
        <h2>Topology</h2>
        <div class="actions">
          <button class="danger" (click)="storm()">Simulate full outage</button>
          <button (click)="restoreAll()">Restore all</button>
        </div>
        @for (n of nodes(); track n.name) {
          <div class="node s-{{ status(n.name) }}" [style.margin-left.px]="n.depth * 28">
            <span class="dot"></span>
            <strong>{{ n.name }}</strong>
            <em>{{ label[status(n.name)] }}</em>
            <span class="spacer"></span>
            <button (click)="fail(n.name)">Fail</button>
            <button (click)="restore(n.name)">Restore</button>
          </div>
        }
      </section>

      <section class="panel">
        <h2>Root cause events</h2>
        @for (i of incidents(); track $index) {
          <div class="incident">
            <div><b>{{ i.root_cause }}</b> <small>{{ i.ts }}</small></div>
            <div>{{ i.alarms_received }} alarms → 1 root cause</div>
            <div class="muted">impacted: {{ i.impacted.length ? i.impacted.join(', ') : 'none' }}</div>
          </div>
        } @empty { <p class="muted">No incidents yet. Fail a device.</p> }

        <h2>Live alarm feed</h2>
        <div class="feed">
          @for (a of alarms().slice(0, 15); track $index) {
            <div>{{ a.source }} · {{ a.device }} · {{ a.state }}</div>
          }
        </div>
      </section>
    </main>
  `,
  styles: [`
    :host { display:block; font-family: system-ui, sans-serif; background:#0f172a; color:#e2e8f0; min-height:100vh; padding:20px; box-sizing:border-box; }
    header { display:flex; align-items:baseline; gap:16px; } h1 { margin:0 0 16px; } header span { color:#94a3b8; }
    .stats { display:flex; gap:12px; margin-bottom:16px; }
    .card { background:#1e293b; padding:12px 20px; border-radius:8px; } .card b { font-size:28px; display:block; } small,.muted { color:#94a3b8; }
    main { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
    .panel { background:#1e293b; border-radius:8px; padding:16px; } h2 { margin-top:0; font-size:16px; }
    .actions { margin-bottom:12px; display:flex; gap:8px; }
    button { background:#334155; color:#e2e8f0; border:0; border-radius:6px; padding:5px 10px; cursor:pointer; } button:hover { background:#475569; }
    button.danger { background:#b91c1c; }
    .node { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; margin-bottom:6px; background:#0f172a; border-left:4px solid #22c55e; }
    .node em { font-style:normal; font-size:12px; color:#94a3b8; } .spacer { flex:1; }
    .dot { width:10px; height:10px; border-radius:50%; background:#22c55e; }
    .s-root { border-left-color:#ef4444; } .s-root .dot { background:#ef4444; }
    .s-sup { border-left-color:#f59e0b; } .s-sup .dot { background:#f59e0b; }
    .s-down { border-left-color:#f97316; } .s-down .dot { background:#f97316; }
    .incident { background:#0f172a; padding:10px; border-radius:6px; margin-bottom:8px; }
    .feed { font-family: monospace; font-size:12px; color:#94a3b8; max-height:200px; overflow:auto; }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  topology = signal<Record<string, string | null>>({});
  down = signal<string[]>([]);
  incidents = signal<Incident[]>([]);
  alarms = signal<Alarm[]>([]);
  label: Record<string, string> = { root: 'ROOT CAUSE', sup: 'SUPPRESSED', down: 'DOWN (correlating…)', up: 'UP' };
  private es?: EventSource;
  private timer?: any;

  nodes = computed(() => {
    const t = this.topology();
    const out: { name: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const [name, p] of Object.entries(t)) {
        if (p === parent) { out.push({ name, depth }); walk(name, depth + 1); }
      }
    };
    walk(null, 0);
    return out;
  });

  // latest incident per root, only while that root is still down
  roots = computed(() => {
    const down = new Set(this.down());
    const seen = new Set<string>();
    const res: Incident[] = [];
    for (const i of this.incidents()) {
      if (!seen.has(i.root_cause)) {
        seen.add(i.root_cause);
        if (down.has(i.root_cause)) res.push(i);
      }
    }
    return res;
  });
  suppressed = computed(() => this.roots().reduce((n, i) => n + i.impacted.length, 0));

  status(n: string): string {
    const r = this.roots();
    if (r.some(i => i.root_cause === n)) return 'root';
    if (r.some(i => i.impacted.includes(n))) return 'sup';
    if (this.down().includes(n)) return 'down';
    return 'up';
  }

  ngOnInit() {
    this.http.get<Record<string, string | null>>(`${API}/topology`).subscribe(t => this.topology.set(t));
    this.http.get<Incident[]>(`${API}/incidents`).subscribe(i => this.incidents.set(i));
    this.http.get<Alarm[]>(`${API}/alarms`).subscribe(a => this.alarms.set(a));
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 2000);

    this.es = new EventSource(`${API}/stream`);
    this.es.addEventListener('incident', (e: any) =>
      this.incidents.update(v => [JSON.parse(e.data), ...v].slice(0, 100)));
    this.es.addEventListener('alarm', (e: any) =>
      this.alarms.update(v => [JSON.parse(e.data), ...v].slice(0, 200)));
  }

  ngOnDestroy() { this.es?.close(); clearInterval(this.timer); }

  refresh() { this.http.get<string[]>(`${API}/sim`).subscribe(d => this.down.set(d)); }
  fail(n: string) { this.http.post(`${API}/sim/${n}/down`, {}).subscribe(() => this.refresh()); }
  restore(n: string) { this.http.post(`${API}/sim/${n}/up`, {}).subscribe(() => this.refresh()); }
  storm() { this.nodes().forEach(n => this.fail(n.name)); }
  restoreAll() { this.nodes().forEach(n => this.restore(n.name)); }
}
