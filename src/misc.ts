export function UnionUndefined<T>(val: T): T|undefined {
    return val;
}

export const g: typeof window = new Function("return this")();