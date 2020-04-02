export function UnionUndefined<T>(val: T): T|undefined {
    return val;
}

export const g: typeof window = new Function("return this")();

export function keyBy<T>(a: T[], key: (obj: T, index: number) => string = x => String(x), noCollisionWarning = false): { [key: string]: T } {
    let dict: { [key: string]: T } = Object.create(null);
    for(let i = 0; i < a.length; i++) {
        let obj = a[i];
        let keyStr = key(obj, i);
        if(!noCollisionWarning) {
            if(keyStr in dict) {
                console.warn(`keyBy has collision in key ${keyStr}`, a);
            }
        }
        dict[keyStr] = obj;
    }
    return dict;
}

export function isShallowEqual<T>(a: T, b: T): boolean {
    if(!a || !b || typeof a !== "object" || typeof b !== "object") return a === b;
    for(let key in a) {
        if(a[key] !== b[key]) return false;
    }
    for(let key in b) {
        if(a[key] !== b[key]) return false;
    }
    return true;
}

export function min<T>(lhs: T, rhs: T): T {
    if(lhs <= rhs) return lhs;
    return rhs;
}
export function max<T>(lhs: T, rhs: T): T {
    if(lhs > rhs) return lhs;
    return rhs;
}