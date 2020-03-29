interface Array<T> {
    last(): T|undefined;
    lastThrow(): T;
}
interface ReadonlyArray<T> {
    last(): T|undefined;
    lastThrow(): T;
}

if(!("last" in Array.prototype)) {
    (Array.prototype as any).last = function() { return this[this.length - 1]; };
}
if(!("lastThrow" in Array.prototype)) {
    (Array.prototype as any).lastThrow = function() {
        if(this.length === 0) { throw new Error(`lastThrow called on empty array.`); }
        return this[this.length - 1];
    };
}