const pathPartSuffix = " . ";


export function joinPathHashes(lhs: EyeTypes.Path2, rhs: EyeTypes.Path2): string {
    return lhs.pathHash + pathPartSuffix + rhs.pathHash;
}


const subPathDelimitter = " .# ";
const keyPathDelimitter = ` .$ `;

// If the suffix is replaced with this, then it will sort after all children. This is because
//  the "." character cannot exist in isolation (it will be escaped), and as "#" > " ", this will sort
//  after all of the children, but before any non-children that were simply escaped, that could only escape
//  to " .." at best, and as "#" < ".", this will sort before them.
const lastChildSuffix = " .-";



export const rootPath: EyeTypes.Path2 = Object.freeze({
    path: Object.freeze([]),
    pathHash: pathPartSuffix,
    // Just for debugging, if this causes a performance penalty then we should remove it.
    [Symbol.toPrimitive as any]() { return this.pathHash; }
});

/** Hash guaranteed to be > all path hashes */
export const hashAfterLastPath = lastChildSuffix;

export function getRootKey(key: PropertyKey | PropertyKey[]): EyeTypes.Path2 {
    return getChildPath(rootPath, key);
}

export function escapePathPart(pathPart: string) {
    if(typeof pathPart !== "string") {
        debugger;
    }
    // TODO: A pathPart.indexOf check to early out when we don't have to run this would probably be a lot faster. But we should wait for a benchmark before we change it.
    return (
        pathPart
        .replace(/\./g, "..")
    );
}
function unescapePathPart(pathPart: string) {
    return (
        pathPart.replace(/\.\./g, ".")
    );
}
// TODO: Create a global cache to do this faster. Of course... only once we can find a single case where this function can even measure on a benchmark...
export function getParentPath(path: EyeTypes.Path2): EyeTypes.Path2 {
    let pathHash = path.pathHash;
    let index = pathHash.lastIndexOf(pathPartSuffix, pathHash.length - pathPartSuffix.length - 1);
    if(index === -1) {
        throw new Error(`pathHash is invalid. Hash: ${pathHash}`);
    }
    return {
        path: path.path.slice(0, -1),
        pathHash: pathHash.slice(0, index + pathPartSuffix.length),
        // Just for debugging, if this causes a performance penalty then we should remove it.
        [Symbol.toPrimitive as any]() { return this.pathHash; }
    };
}


export function getChildPath(path: EyeTypes.Path2, childKeyRaw: Readonly<PropertyKey | PropertyKey[]>): EyeTypes.Path2 {
    // Cast, so Array.isArray works.
    let childKey: PropertyKey | PropertyKey[] = childKeyRaw as any;
    if(Array.isArray(childKey)) {
        childKey = childKey.map(x => getKeyHash(x)).join(subPathDelimitter);
    } else {
        childKey = getKeyHash(childKey);
    }
    let pathHash = path.pathHash + childKey + pathPartSuffix;
    return {
        path: path.path.concat(childKey),
        pathHash: pathHash,
        // Just for debugging, if this causes a performance penalty then we should remove it.
        [Symbol.toPrimitive as any]() { return this.pathHash; }
    };
}

export function expandChildPaths(path: EyeTypes.Path2): (PropertyKey | PropertyKey[])[] {
    return path.path.map(x => typeof x === "string" ? x.split(subPathDelimitter).map(getKeyFromHash) : x);
}

export function getHashAfterLastChild(hash: string): string {
    if(!hash.endsWith(pathPartSuffix)) {
        throw new Error(`Internal error, path is invalid`);
    }
    return hash.slice(0, -pathPartSuffix.length) + lastChildSuffix;
}


let symbolSeqNum = 0;
// TODO: This is a memory leak. However, I don't see how else to do it. WeakMaps only accept object keys, which would be the only way to do this.
//  Probably because Symbol.for resurrect a symbol that doesn't appear to have references. So... let's just
//  hope no one creates too many symbols...
let symbolUniqueLookup: { [key in symbol]: number|string } = Object.create(null);
let symbolReverseLookup: { [key: string]: symbol } = Object.create(null);

export function definePathSymbolName(symbol: symbol, id: string) {
    if(id.startsWith("Symbol(")) {
        throw new Error(`Tried to define id that may conflict with automatically generated symbol id. Don't do that.`);
    }
    if(symbol in symbolUniqueLookup) {
        throw new Error(`Tried to defined symbol name twice. Was ${(symbolUniqueLookup as any)[symbol]}, tried to define it again as ${id}`);
    }
    if(id in symbolReverseLookup) {
        throw new Error(`Tried to defined two symbol to the same id. Id ${id}`);
    }
    (symbolUniqueLookup as any)[symbol] = id;
    symbolReverseLookup[id] = symbol;
}

export function joinHashes(rootHash: string, childHash: string) {
    return rootHash + pathPartSuffix + childHash;
}

export function getKeyHash(key: PropertyKey) {
    let typeText: string = typeof key;
    if(typeText === "string") {
        typeText = "";
    } else if(typeText === "number") {
        typeText = "n";
    } else if(typeText === "symbol") {
        typeText = "s";
    }
    if(typeof key === "symbol") {
        if(!(key in symbolUniqueLookup)) {
            (symbolUniqueLookup as any)[key] = symbolSeqNum++;
        }
        let id = (symbolUniqueLookup as any)[key];
        if(typeof id === "string") {
            key = id;
        } else {
            key = String(key) + "_" + String((symbolUniqueLookup as any)[key]);
        }
    }
    let keyText;
    if(typeText === "") {
        keyText = escapePathPart(String(key));
    } else {
        keyText = typeText + keyPathDelimitter + escapePathPart(String(key));
    }
    return keyText;
}
function getKeyFromHash(hash: string): PropertyKey {
    let typeArr = hash.split(keyPathDelimitter);
    if(typeArr.length === 1) {
        return unescapePathPart(typeArr[0]);
    }
    if(typeArr.length !== 2) {
        throw new Error(`Invalid key hash`);
    }
    let type = typeArr[0];
    let value: string = unescapePathPart(typeArr[1]);
    if(type === "") {
        return value;
    } else if(type === "n") {
        return +value;
    } else if(type === "s") {
        if(!(value in symbolReverseLookup)) {
            debugger;
            throw new Error(`Invalid symbol id ${value}`);
        }
        return symbolReverseLookup[value];
    } else {
        throw new Error(`Invalid key hash, type ${type}`);
    }
}



/** Should only be used if you need to load from the disk, and if any symbols are encountered a definition must have been defined with definedPathSymbolName. */
export function getPathFromHash(pathHash: string): EyeTypes.Path2 {
    //todonext;
    // UGH... we need to go from hash to path, so we can load them off the disk...
    //  Uh... this works, we can just throw an error if there is a symbol that hasn't been defined with definePathSymbolName...
    let parts = pathHash.split(pathPartSuffix).slice(1, -1);
    let path = parts.map(x => x.split(subPathDelimitter).map(getKeyFromHash));

    return pathFromArray(path);
}


export function getParentHash(pathHash: string): string {
    if(pathHash === rootPath.pathHash) {
        throw new Error(`Cannot get parent hash for the root hash ${rootPath.pathHash}`);
    }

    let newEnd = pathHash.lastIndexOf(pathPartSuffix, pathHash.length - pathPartSuffix.length - 1);
    if(newEnd < 0) {
        throw new Error(`pathHash is invalid. Hash: ${pathHash}`);
    }
    let parentHash = pathHash.slice(0, newEnd);
    if(parentHash === rootPath.pathHash) {
        return parentHash;
    }
    return parentHash + pathPartSuffix;
}
export function getLastKeyHash(pathHash: string): string {
    if(pathHash === rootPath.pathHash) {
        throw new Error(`Cannot get parent hash for the root hash ${rootPath.pathHash}`);
    }

    let newEnd = pathHash.lastIndexOf(pathPartSuffix, pathHash.length - pathPartSuffix.length - 1);
    if(newEnd < 0) {
        throw new Error(`pathHash is invalid. Hash: ${pathHash}`);
    }
    return pathHash.slice(newEnd + pathPartSuffix.length, -pathPartSuffix.length);
}

export function joinPaths(path: EyeTypes.Path2, childPath: EyeTypes.Path2): EyeTypes.Path2 {
    if(childPath.path.length === 0) {
        return path;
    }
    if(path.path.length === 0) {
        return childPath;
    }
    return {
        path: path.path.concat(childPath.path),
        // We already verified that both path and child aren't empty, so this concentation is safe
        pathHash: path.pathHash + pathPartSuffix + childPath.pathHash,
        [Symbol.toPrimitive as any]() { return this.pathHash; }
    };
}


/* Just for debugging. "x.y.z" => ["x", "y", "z"]
    Also, "." => [""], because that is useful, and there isn't another way to represent that
        (and having it map to ["",""] is not useful).
*/
function p(pathString: string): string[] {
    if(!pathString) return [];
    if(pathString === ".") {
        return [""];
    }
    let arr = pathString.split(".");
    return arr;
}

/** Debug function to convert from dot paths to a dot path to a path hash */
export function p2(dotPath: string): EyeTypes.Path2 {
    return {
        path: p(dotPath),
        pathHash: pathPartSuffix + p(dotPath).map(x => x + pathPartSuffix).join(""),
        // Just for debugging, if this causes a performance penalty then we should remove it.
        [Symbol.toPrimitive as any]() { return this.pathHash; }
    };
}

let inPathFromArray = false;
export function pathFromArray(path: DeepReadonly<(PropertyKey | PropertyKey[])[]>): EyeTypes.Path2 {
    let curPath = rootPath;
    for(let key of path) {
        curPath = getChildPath(curPath, key);
    }

    /*
    if(!inPathFromArray) {
        inPathFromArray = true;
        try {
            let pathTest = getPathFromHash(curPath.pathHash).path;
            if(path.length !== pathTest.length) {
                debugger;
            }
            for(let i = 0; i < path.length; i++) {
                let a = path[i];
                let b = pathTest[i];
                if(Array.isArray(a) !== Array.isArray(b)) {
                    debugger;
                    getPathFromHash(curPath.pathHash);
                }
                if(Array.isArray(a) && Array.isArray(b)) {
                    if(a.length !== b.length) {
                        debugger;
                    }
                    for(let j = 0; j < a.length; j++) {
                        if(a[j] !== b[j]) {
                            debugger;
                        }
                    }
                } else if(a !== b) {
                    debugger;
                }
            }
        } finally {
            inPathFromArray = false;
        }
    }
    */

    return curPath;
}