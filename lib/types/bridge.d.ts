/** 仓库桥：证据工具经此访问 repoRoot（client fs）。图编辑工具不经此（只读写 rootDir 图数据）。 */
export interface RepoBridge {
    /** 读 repoRoot 下相对 path 的字节。missing 时返 {ok:false,missing:true}（不抛）。 */
    readFile(path: string): Promise<{
        ok: true;
        bytes: Buffer;
    } | {
        ok: false;
        missing: true;
    }>;
    /** repoRoot 下相对 path 是否存在。 */
    exists(path: string): Promise<boolean>;
    /** 仓库当前 HEAD（40 位 SHA）；git 不可用时返 error。 */
    gitHead(): {
        sha: string | null;
        error: string | null;
    };
    /** git 变更文件清单（增量再生成的输入）。diff 默认 HEAD。 */
    gitChangedFiles(diff?: string): {
        files: string[] | null;
        error: string | null;
    };
}
/** 本地 fs+git 桥（DSH/stdio 单用户：client fs = server fs）。 */
export declare class LocalBridge implements RepoBridge {
    private readonly repoRoot;
    constructor(repoRoot: string);
    readFile(path: string): Promise<{
        ok: true;
        bytes: Buffer;
    } | {
        ok: false;
        missing: true;
    }>;
    exists(path: string): Promise<boolean>;
    gitHead(): {
        sha: string | null;
        error: string | null;
    };
    gitChangedFiles(diffSpec?: string): {
        files: string[] | null;
        error: string | null;
    };
}
/** R3 推送快照桥（DP4）：从 client 推的字节缓存读，不访问 client fs。 */
export declare class SessionCacheBridge implements RepoBridge {
    private readonly files;
    private readonly head;
    private readonly changed;
    constructor(data: {
        files: Record<string, string>;
        gitHead?: {
            sha: string | null;
            error: string | null;
        };
        gitChangedFiles?: {
            files: string[] | null;
            error: string | null;
        };
    });
    readFile(path: string): Promise<{
        ok: true;
        bytes: Buffer;
    } | {
        ok: false;
        missing: true;
    }>;
    exists(path: string): Promise<boolean>;
    gitHead(): {
        sha: string | null;
        error: string | null;
    };
    gitChangedFiles(diffSpec?: string): {
        files: string[] | null;
        error: string | null;
    };
}
