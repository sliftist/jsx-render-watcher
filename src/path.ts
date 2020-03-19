const pathPartSuffix = " . ";
/** A delimitter which can be used to concatentate ordered guids, without colliding with any special characters in the hashes themselves. */
const safeOrderedGuidHashDelimitter = pathPartSuffix;

export function joinPathHashes(lhs: EyeTypes.Path2, rhs: EyeTypes.Path2): string {
    return lhs.pathHash + pathPartSuffix + rhs.pathHash;
}


const safePathDelimitter = " ... ";
//export const safePathDelimitter2 = " ..... ";


export const rootPath: EyeTypes.Path2 = Object.freeze({
    path: Object.freeze([]),
    pathHash: pathPartSuffix,
    // Just for debugging, if this causes a performance penalty then we should remove it.
    [Symbol.toPrimitive as any]() { return this.pathHash; }
});

export function getRootKey(key: PropertyKey, seqNum?: number): EyeTypes.Path2 {
    return getChildPath(rootPath, key, seqNum);
}

export function escapePathPart(pathPart: string) {
    if(typeof pathPart !== "string") {
        debugger;
    }
    // TODO: A pathPart.indexOf check here would probably make this a lot faster. But we should wait for a benchmark before we change it.
    return pathPart.replace(/\./g, "..");
}
export function unescapePathPart(pathPart: string) {
    // TODO: A pathPart.indexOf check here would probably make this a lot faster. But we should wait for a benchmark before we change it.
    return pathPart.replace(/\.\./g, ".");
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
export function getChildPath(path: EyeTypes.Path2, childKey: PropertyKey, seqNum?: number): EyeTypes.Path2 {
    return {
        path: path.path.concat(childKey),
        pathHash: getChildHash(path.pathHash, childKey, seqNum),
        // Just for debugging, if this causes a performance penalty then we should remove it.
        [Symbol.toPrimitive as any]() { return this.pathHash; }
    };
}

let symbolSeqNum = 0;
// TODO: This is a memory leak. However, I don't see how else to do it. WeakMaps only accept object keys.
//  Probably because Symbol.for and resurrect a symbol that doesn't appear to have references. So... let's just
//  hope no one creates too many symbols...
let symbolUniqueLookup: { [key in PropertyKey]: number } = Object.create(null);
function getChildHash(pathHash: string, childKey: PropertyKey, seqNum?: number): string {
    let typeText = typeof childKey;
    if(typeof childKey === "symbol") {
        if(!(childKey in symbolUniqueLookup)) {
            symbolUniqueLookup[childKey as any] = symbolSeqNum++;
        }
        childKey = String(childKey) + "_" + String(symbolUniqueLookup[childKey as any]);
    }
    let keyText = typeText + safePathDelimitter + escapePathPart(String(childKey));
    if(seqNum !== undefined) {
        keyText += safePathDelimitter + seqNum;
    }
    return pathHash + keyText + pathPartSuffix;
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

export function pathFromArray(path: readonly string[]): EyeTypes.Path2 {
    return {
        path: path,
        pathHash: pathPartSuffix + path.map(x => x + pathPartSuffix).join(""),
        // Just for debugging, if this causes a performance penalty then we should remove it.
        [Symbol.toPrimitive as any]() { return this.pathHash; }
    };
}