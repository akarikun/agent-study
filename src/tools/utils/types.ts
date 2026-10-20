export type Tool = {
    description: string;
    // 工具能力说明，供工具列表展示；不代表操作系统层面的权限隔离。
    readOnly?: boolean;
    execute: (params: any) => Promise<unknown>;
};
