//As in a JS number... as obviously... why would we want to detect non-JS numbers. I am not explaining that.
export function isNumber(str: string): boolean {
    return (+str).toString() === str;
}

export function isInteger(num: number): boolean {
    return Number.isSafeInteger(num);
}

// bigint is not considered a primitive, as it is not serializable by JSON.stringify (as of now). We may
//  consider running `BigInt.prototype.toJSON = function() { return String(this) + "n"; }`, except then
//  JSON.parse wouldn't work... So I don't know, bigint can't be serialized, so it isn't a primitive.
export function isPrimitive(value: Types.AnyAll): value is Types.Primitive {
    let type = typeof value;
    if(type === "string") return true;
    if(type === "number") return true;
    if(type === "boolean") return true;
    if(type === "undefined") return true;
    if(value === null) return true;
    return false;
}

/** As in, {} can have children. But null can't. Also, function(){} doesn't count. Yes, it can have children, but it is more likely a mistake. */
export function canHaveChildren(value: Types.AnyAll): value is Types.Dictionary {
    return value && typeof value === "object" || false;
}

export function isArray(obj: Types.AnyAll): obj is Types.Arr {
    return obj instanceof Array;
}

export function isObject(obj: unknown): obj is { [key: string]: unknown } {
    return obj && typeof obj === "object";
}

export function UnionUndefined<T>(val: T): T|undefined {
    return val;
}

export function assertDefined<T>(value: T|undefined|null): T {
    if(!value) throw new Error(`Value is undefined`);
    return value;
}