import * as vscode from 'vscode';

interface Hunk {
  id: string;
  start: number;
  end: number;
  before: string;
  after: string;
}
interface Proposal {
  id: string;
  filePath: string;
  source: 'manual';
  label: string;
  createdAt: number;
  uri: vscode.Uri;
  hunks: Hunk[];
}

const proposals: Proposal[] = [];
let panel: BoottrayView | undefined;
let status: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  panel = new BoottrayView(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('boottray.panel', panel, { webviewOptions: { retainContextWhenHidden: true } }));
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'boottray.open';
  status.tooltip = 'Open the Boottray proposal tray';
  context.subscriptions.push(status);
  updateStatus();

  context.subscriptions.push(
    vscode.commands.registerCommand('boottray.open', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.boottray-container');
      panel?.refresh();
    }),
    vscode.commands.registerCommand('boottray.stageSelection', stageSelection),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (proposals.some((proposal) => proposal.uri.toString() === event.document.uri.toString())) panel?.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('boottray.showStatusBar')) updateStatus();
    })
  );
}

function updateStatus(): void {
  if (!status) return;
  status.text = `Boottray: ${proposals.length}`;
  status.show();
}

async function stageSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Boottray needs an open file.');
    return;
  }
  const document = editor.document;
  const selection = editor.selection.isEmpty ? new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)) : editor.selection;
  const before = document.getText(selection);
  const start = document.offsetAt(selection.start);
  const end = document.offsetAt(selection.end);
  addProposal({
    filePath: vscode.workspace.asRelativePath(document.uri),
    source: 'manual',
    label: 'manual stage',
    uri: document.uri,
    hunks: [{ id: id(), start, end, before, after: before }]
  });
  vscode.window.showInformationMessage('Selection staged in Boottray.');
}

function addProposal(input: Omit<Proposal, 'id' | 'createdAt'>): void {
  proposals.unshift({ ...input, id: id(), createdAt: Date.now() });
  updateStatus();
  panel?.refresh();
}

function id(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function applyProposal(proposal: Proposal, hunkId?: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(proposal.uri);
  const targets = proposal.hunks.filter((hunk) => !hunkId || hunk.id === hunkId);
  const edit = new vscode.WorkspaceEdit();
  for (const hunk of [...targets].sort((a, b) => b.start - a.start)) {
    const current = document.getText().slice(hunk.start, hunk.end);
    if (current !== hunk.before) {
      vscode.window.showWarningMessage(`Boottray skipped a stale hunk in ${proposal.filePath}. Stage it again.`);
      continue;
    }
    edit.replace(proposal.uri, new vscode.Range(document.positionAt(hunk.start), document.positionAt(hunk.end)), hunk.after);
  }
  if (edit.size > 0) await vscode.workspace.applyEdit(edit);
  if (!hunkId || targets.length === proposal.hunks.length) {
    const index = proposals.findIndex((item) => item.id === proposal.id);
    if (index >= 0) proposals.splice(index, 1);
  } else {
    proposal.hunks = proposal.hunks.filter((hunk) => hunk.id !== hunkId);
    if (!proposal.hunks.length) proposals.splice(proposals.indexOf(proposal), 1);
  }
  updateStatus();
  panel?.refresh();
}

function rejectProposal(idToReject: string): void {
  const index = proposals.findIndex((proposal) => proposal.id === idToReject);
  if (index >= 0) proposals.splice(index, 1);
  updateStatus();
  panel?.refresh();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character] ?? character));
}

class BoottrayView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private readonly extensionUri: vscode.Uri) {}
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'accept') await this.handleAccept(message.id);
      if (message.type === 'acceptHunk') await this.handleAccept(message.id, message.hunkId);
      if (message.type === 'reject') rejectProposal(message.id);
      if (message.type === 'rejectAll') { proposals.splice(0); updateStatus(); this.refresh(); }
      if (message.type === 'openFile') {
        const proposal = proposals.find((item) => item.id === message.id);
        if (proposal) await vscode.window.showTextDocument(proposal.uri);
      }
    });
    this.refresh();
  }
  async handleAccept(proposalId: string, hunkId?: string): Promise<void> {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (proposal) await applyProposal(proposal, hunkId);
  }
  refresh(): void {
    if (this.view) this.view.webview.html = this.html(this.view.webview);
  }
  private html(webview: vscode.Webview): string {
    const nonce = id();
    const payload = JSON.stringify(proposals.map((proposal) => ({ ...proposal, uri: proposal.uri.toString() })));
    const cards = proposals.map((proposal) => this.card(proposal)).join('');
    return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>${styles}</style></head><body><header><div class="brand"><span class="mark">✓</span><div><h1>Boottray</h1><p>Nothing lands without a yes.</p></div></div><span class="count">${proposals.length}</span></header><main>${cards || "<section class=empty><div class=empty-mark>⌁</div><h2>Tray is clean</h2><p>Stage a real selection from the editor. Point to <strong>Boottray: Stage Selection</strong>. Your editor stays untouched until you accept.</p></section>"}</main>${proposals.length ? "<footer><button class=reject-all data-command=rejectAll>Reject all</button><span>Review first. Always.</span></footer>" : ""}<script nonce="${nonce}">const vscode=acquireVsCodeApi(); const state=${payload}; document.addEventListener("click",event=>{const button=event.target.closest("button"); if(!button)return; const command=button.dataset.command; const id=button.dataset.id; if(command==="accept") vscode.postMessage({type:"accept",id}); if(command==="acceptHunk") vscode.postMessage({type:"acceptHunk",id,hunkId:button.dataset.hunk}); if(command==="reject") vscode.postMessage({type:"reject",id}); if(command==="rejectAll") vscode.postMessage({type:"rejectAll"}); if(command==="open") vscode.postMessage({type:"openFile",id});}); document.querySelectorAll("details").forEach(detail=>detail.addEventListener("toggle",()=>detail.classList.toggle("open",detail.open)));</script></body></html>`;
  }
  private card(proposal: Proposal): string {
    const hunks = proposal.hunks.map((hunk, index) => `<div class="hunk"><div class="hunk-head"><span>HUNK ${String(index + 1).padStart(2, '0')}</span><button class="tiny" data-command="acceptHunk" data-id="${proposal.id}" data-hunk="${hunk.id}">Accept hunk</button></div><pre><span class="minus">${escapeHtml(hunk.before || '∅')}</span><span class="plus">${escapeHtml(hunk.after || '∅')}</span></pre></div>`).join('');
    return `<article><div class="card-top"><div><button class="file" data-command="open" data-id="${proposal.id}">${escapeHtml(proposal.filePath)}</button><div class="meta"><span class="badge manual">${proposal.source}</span><span>${relativeTime(proposal.createdAt)}</span></div></div><span class="label">${escapeHtml(proposal.label)}</span></div><details><summary>View ${proposal.hunks.length} hunk${proposal.hunks.length === 1 ? '' : 's'} <span>⌄</span></summary>${hunks}</details><div class="actions"><button class="accept" data-command="accept" data-id="${proposal.id}">Accept</button><button class="reject" data-command="reject" data-id="${proposal.id}">Reject</button></div></article>`;
  }
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

const styles = `:root{color-scheme:dark;--ink:#151311;--panel:#1d1916;--panel2:#241e1a;--line:#3b2f27;--cream:#efe4d7;--muted:#a99b8e;--brown:#b77b4b;--orange:#d59b62;--red:#c87861}*{box-sizing:border-box}body{margin:0;padding:18px 14px 20px;background:var(--ink);color:var(--cream);font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{display:flex;align-items:flex-start;justify-content:space-between;margin:0 2px 22px}.brand{display:flex;gap:10px;align-items:center}.mark{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--brown);color:var(--orange);font-size:16px;font-weight:700;transform:rotate(-8deg)}h1{font:700 16px/1 Georgia,serif;letter-spacing:.02em;margin:0 0 4px}p{color:var(--muted);margin:0}.count{font:700 11px/1;color:var(--orange);background:#3a271b;border:1px solid #704a2e;padding:7px 8px;border-radius:20px}.empty{border:1px dashed #4b3a2e;padding:24px 16px;text-align:center;background:linear-gradient(135deg,#1c1714,#211a16)}.empty-mark{color:var(--brown);font-size:29px;line-height:1;margin-bottom:12px}.empty h2{font:700 19px Georgia,serif;margin:0 0 8px}.empty p{max-width:250px;margin:0 auto 18px}button{font:600 11px inherit;cursor:pointer;border:0;color:var(--cream)}article{border:1px solid var(--line);background:var(--panel);margin-bottom:10px;box-shadow:0 4px 10px #0002}.card-top{display:flex;justify-content:space-between;gap:8px;padding:12px 11px 9px}.file{padding:0;background:none;color:var(--cream);font:600 12px ui-monospace,SFMono-Regular,monospace;text-align:left;overflow-wrap:anywhere}.file:hover{color:var(--orange)}.meta{display:flex;align-items:center;gap:8px;color:var(--muted);margin-top:7px}.badge{font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:2px 5px;border-radius:2px}.badge.manual{background:#30302a;color:#c3c6a6}.label{color:#75685d;font-size:10px;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}.actions{display:flex;gap:7px;padding:10px 11px;border-top:1px solid var(--line)}.accept{background:var(--brown);padding:7px 12px;border-radius:2px}.accept:hover{background:var(--orange);color:#21160f}.reject,.reject-all{background:transparent;color:var(--red);padding:7px 10px}.reject:hover,.reject-all:hover{background:#3a211c}details{border-top:1px solid var(--line)}summary{list-style:none;color:var(--muted);padding:9px 11px;cursor:pointer;font-size:11px}summary::-webkit-details-marker{display:none}summary span{float:right;color:var(--brown)}details.open summary span{transform:rotate(180deg)}.hunk{margin:0 10px 10px;border:1px solid #352a23;background:#181514}.hunk-head{display:flex;justify-content:space-between;padding:6px 8px;border-bottom:1px solid #31251f;color:#76675c;font-size:9px;letter-spacing:.1em}.tiny{background:transparent;color:var(--orange);font-size:10px;padding:0}.hunk pre{margin:0;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.5 ui-monospace,SFMono-Regular,monospace}.hunk pre span{display:block;padding:2px 5px}.minus{background:#3c211e;color:#e0a29b}.minus:before{content:'- ';color:#c87861}.plus{background:#263122;color:#bbd09d}.plus:before{content:'+ ';color:#a6c778}footer{display:flex;justify-content:space-between;align-items:center;margin-top:16px;color:#6f6258;font-size:10px}.reject-all{padding-left:0}`;
