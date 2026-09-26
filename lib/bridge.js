// dual-side-mode DP1：Bridge 抽象。
// RepoBridge 接口把证据工具的 repoRoot 访问（readFile/exists/gitHead/gitChangedFiles）虚拟化，
// 25+ 图工具不碰 Bridge（只读写 rootDir 图数据）。
// LocalBridge 包本地 fs+git（DSH/stdio 单用户）；SessionCacheBridge（DP4）从 R3 推送快照读字节。
// path 为相对 repoRoot 的相对路径（LocalBridge 内部 join(repoRoot, path)）。
import { readFile } from 'node:fs/promises';
import { existsSync as fsExistsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
/** 本地 fs+git 桥（DSH/stdio 单用户：client fs = server fs）。 */
export class LocalBridge {
    repoRoot;
    constructor(repoRoot) {
        this.repoRoot = repoRoot;
    }
    async readFile(path) {
        try {
            const bytes = await readFile(join(this.repoRoot, path));
            return { ok: true, bytes };
        }
        catch {
            return { ok: false, missing: true };
        }
    }
    async exists(path) {
        return fsExistsSync(join(this.repoRoot, path));
    }
    gitHead() {
        const result = spawnSync('git', ['-C', this.repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
        if (result.error !== undefined)
            return { sha: null, error: 'git 不可用：' + result.error.message };
        if (result.status !== 0)
            return { sha: null, error: 'git rev-parse 失败：' + String(result.stderr ?? '').slice(0, 200) };
        const sha = String(result.stdout).trim();
        if (!/^[a-f0-9]{40}$/.test(sha))
            return { sha: null, error: 'git HEAD 不是 40 位 SHA：' + sha };
        return { sha, error: null };
    }
    gitChangedFiles(diffSpec) {
        const spec = (diffSpec ?? '').trim() === '' ? 'HEAD' : (diffSpec ?? '').trim();
        const result = spawnSync('git', ['-C', this.repoRoot, 'diff', '--name-only', spec], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (result.error !== undefined) {
            return { files: null, error: 'git 不可用：' + result.error.message };
        }
        if (result.status !== 0) {
            return { files: null, error: 'git diff 失败（exit ' + result.status + '）：' + String(result.stderr ?? '').slice(0, 300) };
        }
        const changed = String(result.stdout).split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
        const untracked = spawnSync('git', ['-C', this.repoRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (untracked.error === undefined && untracked.status === 0) {
            for (const f of String(untracked.stdout).split(/\r?\n/).map(s => s.trim())) {
                if (f.length > 0 && !changed.includes(f))
                    changed.push(f);
            }
        }
        return { files: changed, error: null };
    }
}
/** R3 推送快照桥（DP4）：从 client 推的字节缓存读，不访问 client fs。 */
export class SessionCacheBridge {
    files;
    head;
    changed;
    constructor(data) {
        this.files = new Map(Object.entries(data.files).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
        this.head = data.gitHead ?? { sha: null, error: 'no git snapshot pushed' };
        this.changed = data.gitChangedFiles ?? { files: null, error: 'no git snapshot pushed' };
    }
    async readFile(path) {
        const bytes = this.files.get(path);
        return bytes ? { ok: true, bytes } : { ok: false, missing: true };
    }
    async exists(path) {
        return this.files.has(path);
    }
    gitHead() {
        return this.head;
    }
    gitChangedFiles(diffSpec) {
        return this.changed;
    }
}
//# sourceMappingURL=bridge.js.map