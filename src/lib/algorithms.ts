const uniqueKey = Symbol();
export function binarySearchMapped<T, M>(list: T[], value: M, map: (t: T) => M, comparer: (lhs: M, rhs: M) => number): number {
    return binarySearch<T>(list, {[uniqueKey]: value} as any as T, (a, b) => {
        let aMap = uniqueKey in a ? (a as any)[uniqueKey] as M : map(a);
        let bMap = uniqueKey in b ? (b as any)[uniqueKey] as M : map(b);

        return comparer(aMap, bMap);
    });
}

/** Always returns the index of the first match in the list. */
export function binarySearch<T>(list: T[], value: T, comparer: (lhs: T, rhs: T) => number): number {
    if(!list) {
        debugger;
    }
    let minIndex = 0;
    let maxIndex = list.length;

    while (minIndex < maxIndex) {
        let fingerIndex = ~~((maxIndex + minIndex) / 2);
        // Try to increase the minIndex if the finger is in the middle
        if(minIndex + 2 === maxIndex) {
            fingerIndex = minIndex;
        }
        let finger = list[fingerIndex];
        let comparisonValue = comparer(value, finger);
        // Check the minIndex first
        if(comparisonValue > 0) {
            minIndex = fingerIndex + 1;
        } else if(comparisonValue < 0) {
            maxIndex = fingerIndex;
        } else {
            // Modification to keep searching until we get to the first element that matches.
            if(minIndex + 1 === maxIndex) {
                return fingerIndex;
            }
            maxIndex = fingerIndex + 1;
        }
    }
    return ~minIndex;
}

export function insertIntoListMapped<T, M>(list: T[], value: T, map: (t: T) => M, comparer: (lhs: M, rhs: M) => number, duplicates: "throw"|"ignore"|"add"|"replace" = "throw") {
    return insertIntoList(list, value, (a, b) => comparer(map(a), map(b)), duplicates);
}

export function insertIntoList<T>(list: T[], value: T, comparer: (lhs: T, rhs: T) => number, duplicates: "throw"|"ignore"|"add"|"replace" = "throw"): number {
    let index = binarySearch(list, value, comparer);
    if(index >= 0) {
        if(duplicates === "throw") throw new Error(`Duplicate value in list ${value}.`);
        if(duplicates === "ignore") return index;
        if(duplicates === "replace") {
            list[index] = value;
            return index;
        }
    } else {
        index = ~index;
    }
    list.splice(index, 0, value);
    return index;
}

export function compareString(a: string, b: string): number {
    if(a < b) return -1;
    if(a > b) return +1;
    return 0;
}

export function isEmpty<T>(obj: {[key: string]: T} | undefined | null): boolean {
    if(!obj) {
        return true;
    }
    for(var key in obj) {
        return false;
    }
    return true;
}

export function unreachable(): never {
    throw new Error(`Internal error`);
}

type HasChildren = { [key in PropertyKey]: unknown };
export function canHaveChildren(value: unknown): value is HasChildren | HasChildren&Function {
    return typeof value === "object" && value !== null || typeof value === "function";
}

export function sort<T>(arr: T[], sortKey: (obj: T) => number) {
    arr.sort((a, b) => sortKey(a) - sortKey(b));
}