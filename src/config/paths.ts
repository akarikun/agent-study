// 所有运行时文件都相对项目根目录定位，移动源码或从其他目录启动不改变数据位置。
export const projectRoot = new URL('../../', import.meta.url);
export const projectPath = (relative: string) => new URL(relative, projectRoot);
