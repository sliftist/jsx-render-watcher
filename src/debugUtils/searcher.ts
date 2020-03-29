import { insertIntoList, binarySearchMapped, insertIntoListMapped, binarySearch } from "../lib/algorithms";
import { PathQuery, getHighlight, KeyMatchHighlight, getMatchQuery } from "./highlighter";
import { rootPath, hashAfterLastPath, getHashAfterLastChild, pathFromArray, definePathSymbolName, expandChildPaths, getPathFromHash } from "../lib/path";


const uniqueSymbol = Symbol();


interface SearchObject {
    query: EyeTypes.Path2;
}

type CharBucketList<T> = {
    // TODO: This is sorted by chCount (the count of the ch character). And then secondarily by histoHash.
    chCount: number;
    pathHash: string;
    elem: T;
    histo: Map<string, number>;
}[];
export interface SearchCol<T extends SearchObject> {
    // pathHash to T
    all: Map<string, T>;

    // pathHash to PathQuery
    queries: Map<string, PathQuery>;

    // We insert full pathHashes into here, even though we support searching by path. This works
    //  because constant prefixes don't negatively impact this lookup structure by too much (if all "a"s are increased by 3,
    //  that is fine, it just shifts the chCounts in the a array by 3, without changing order).
    buckets: {
        // First sorted by chCount, and then by pathHash.
        // ch === "" has all values
        [ch: string]: CharBucketList<T>;
    };
}

function getHistogram(text: string) {
    let histo = new Map<string, number>();
    text = text.toLowerCase();
    for(let i = 0; i < text.length; i++) {
        let ch = text[i];
        histo.set(ch, (histo.get(ch) || 0) + 1);
    }
    histo.set("", 0);
    return histo;
}
function getHistoHash(histo: Map<string, number>) {
    let hash = "";
    let keys = Array.from(histo.keys());
    keys.sort();
    for(let ch of keys) {
        if(ch === "_") {
            ch = "__";
        }
        hash += ch + histo.get(ch) + " _ ";
    }
    return hash;
}

function bucketBinarySearch(list: CharBucketList<unknown>, count: number, parentPathHash: string): number {
    return binarySearch(list, uniqueSymbol as any as CharBucketList<unknown>[0], (a, b) => {
        let aCount = a === uniqueSymbol as any ? count : a.chCount;
        let bCount = b === uniqueSymbol as any ? count : b.chCount;
        let aHash = a === uniqueSymbol as any ? parentPathHash : a.pathHash;
        let bHash = b === uniqueSymbol as any ? parentPathHash : b.pathHash;
        if(aCount !== bCount) {
            return aCount - bCount;
        }
        return aHash < bHash ? -1 : aHash > bHash ? +1 : 0;
    });
}

function getBucketRange(list: CharBucketList<unknown>, count: number, parentPathHash?: string): {
    start: number;
    end: number
} {
    let start;
    let end;
    if(parentPathHash) {
        start = bucketBinarySearch(list, count, parentPathHash);
        end = bucketBinarySearch(list, count, getHashAfterLastChild(parentPathHash));
    } else {
        start = bucketBinarySearch(list, count, rootPath.pathHash);
        end = bucketBinarySearch(list, count, hashAfterLastPath);
    }
    if(start < 0) start = ~start;
    if(end < 0) end = ~end;
    return { start, end };
}



// NOTE: It is expected that everything with DisplayInfos (included anything nested under a lookup), will be gathered,
//  and all the like-values (same path, except lookups don't make N different paths, they are in the same group)
//  will be put in the same collection.
//  - AND THEN, when searches happen all collections for all lookups should be searched, and displayed separately.
export function createSearchCollection(): SearchCol<any> {
    return {
        all: new Map(),
        queries: new Map(),
        buckets: Object.create(null),
    };
}



/** Output is ordered by match quality (which only varies when using QueryObjects, otherwise it either matches or doesn't).
 *      query can be from getPathQuery, and paths of inserted elements can be from getPathQuery.
*/
export function searchCol<T extends SearchObject>(
    col: SearchCol<T>,
    /** When there is a query term in the query, and in the collection, they are only matched if they are an exact match. */
    queryRaw: EyeTypes.Path2,
    limit = Number.POSITIVE_INFINITY
): {
    elem: T;
    // Highlight is in parallel with the pathForQuery of the element.
    pathHighlight: KeyMatchHighlight[];
}[] {
    // NOTE: Lists of histograms is a about twice as slow to create (it seems like it would be even slower, but in my tests, it wasn't),
    //  HOWEVER, it can increase search times by many fold, as there is often one character in the search term that is relatively rare.
    //  Even though the search in both cases is fast on my machine (for 260K+ the slowest search is 26ms), this could easily translate
    //  to 100ms or more on a slow machine, which the user will feel. So the faster search is important, for snappiness.
    //  - For 190902 UNIQUE histograms, I profiled:
    //      - made histos in 1220ms
    //      - ran reduceHistos in 1955.531ms, reduced 2022380 to 190902
    //      - ran make bucket in 1386.528ms
    //      - ran bucket search in 30.377ms, "p" with 87175 matches
    //      - ran raw search in 48.587ms, "p" for 87175 matches
    //      - ran bucket search in 18.056ms, "path" with 23547 matches
    //      - ran raw in 50.260ms, "path" for 23547 matches
    //      - ran bucket in 2.714ms, "pathswatched2" with 54 matches
    //      - ran raw in 49.320ms, "pathswatched2" for 54 matches
    //  - So it can be seen, even for small queries such as "path" there is improvement, and for queries with rare parts such
    //      as "pathswatcher2" the improvement is enormous.

    let matches: {
        elem: T;
        pathHighlight: KeyMatchHighlight[];
    }[] = [];


    let query = pathToQueryPath(queryRaw);
    // If we are not a query, we only match against queries (or exact matches)
    //  - Use case #1, DisplayInfo, we pass in an actual path, and get all the DisplayInfos that match it.
    if(Array.isArray(query)) {
        let queryAsText = query.map(x => typeof x === "object" ? x.query : x);
        for(let [pathHash, colQuery] of col.queries.entries()) {
            if(!Array.isArray(colQuery)) continue;
            if(query.length !== colQuery.length) continue;
            let highlights: KeyMatchHighlight[] | undefined = [];
            for(let i = 0; i < query.length; i++) {
                // getMatchQuery
                let a = query[i];
                let b = colQuery[i];
                let aValue = typeof a === "object" ? a.query : String(a);
                let bValue = typeof b === "object" ? b.query : String(b);
                let highlight: KeyMatchHighlight|undefined = undefined;
                if(aValue === bValue) {
                    highlight = { parts: [{ matched: true, key: aValue}] };
                }
                if(!highlight && typeof a === "object") {
                    let h = getMatchQuery(a.query, [bValue], true);
                    if(h) {
                        highlight = h[0];
                    }
                }
                if(!highlight && typeof b === "object") {
                    let h = getMatchQuery(b.query, [aValue], true);
                    if(h) {
                        highlight = h[0];
                    }
                }
                if(!highlight) {
                    highlights = undefined;
                    break;
                }
                highlights.push(highlight);
            }
            
            if(highlights) {
                let elem = col.all.get(pathHash);
                if(!elem) throw new Error(`Internal error, no elem for query`);
                matches.push({
                    elem,
                    pathHighlight: highlights
                });
                if(matches.length >= limit) break;
            }
        }
    }
    if(isNotQuery(query)) {
        let exactMatch = col.all.get(queryRaw.pathHash);
        if(exactMatch) {
            matches.push({ elem: exactMatch, pathHighlight: queryRaw.path.map(x => ({ parts: [{key: String(x), matched: true}] })) });
        }
        return matches;
    }

    // NOTE: We only use the top most query to search. Which means this could be slow if it is better to use an inner part
    //  of a path (which is sandwiched between two path queries) to search. But what can we do? Mkaing this efficient in all cases is HARD.
    let parentPath: PropertyKey[]|undefined;
    let topQuery: string|undefined;
    if(!Array.isArray(query)) {
        topQuery = query.query;
    } else {
        parentPath = [];
        for(let queryPart of query) {
            if(typeof queryPart === "object") {
                topQuery = queryPart.query;
                break;
            } else {
                parentPath.push(queryPart);
            }
        }
        if(topQuery === undefined) {
            debugger;
            throw new Error(`Internal error, isNotQuery must be broken, because it was false, which indicies isQuery, but... this doesn't look like a query.`);
        }
    }

    let queryHisto = getHistogram(topQuery);
    let ranges = Array.from(queryHisto.keys()).filter(key => key in col.buckets).map(key => {
        let range = getBucketRange(col.buckets[key], queryHisto.get(key) || 0);
        return { key, range };
    });
    function v(a: typeof ranges[0]) {
        return a.range.end - a.range.start;
    }
    ranges.sort((a, b) => v(a) - v(b));
    if(ranges.length === 0) {
        return matches;
    }
    let bestRange = ranges[0];

    let bucket = col.buckets[bestRange.key];
    for(let i = bestRange.range.start; i < bestRange.range.end; i++) {
        let { elem, histo } = bucket[i];

        let match = true;
        for(let ch of queryHisto.keys()) {
            let count = histo.get(ch) || 0;
            if(count < (queryHisto.get(ch) || 0)) {
                match = false;
                break;
            }
        }
        if(!match) continue;

        let highlight = getHighlight(query, elem.query.path, true);
        if(highlight) {
            matches.push({
                elem,
                pathHighlight: highlight
            });
            if(matches.length >= limit) break;
        }
    }

    return matches;


    // NOTE:
    // Okay, just a thought experiment (because it is too hard to maintain in a balanced state), but if we split by larger groups that 1 character,
    //  but ranges, like a-ad,ad-ak,ak-b, we could perfectly balance it.
    //  And the, if it is perfectly balanced, any match on average splits by 50%. Hmm... but how many matches can we expect? Maybe,
    //  the query length divided by the average range dimensions, which... will probably be 2, so... it should be quite fast, at 6 characters
    //  that is 1/8 division? Hmm... Well, at 10 getting 1/32 is pretty good. And if it is random text it will probably find that it doesn't
    //  match VERY fast (well, random, but not generated from the balance, instead random as in odd, so maybe a typo?).
    //  - OF COURSE, this is much harder than it seems (and balancing seems hard anyway...), because now our groups are more complicated
    //      shapes. But uh... I guess they would be expressed like: { a: 1, 1 in "a" to "d" }, which would work...
    //      - Is this a superset of the... whatever?, the problem in that dividing a corpus of text into fragments yields a problem when
    //          fragments can overlap. In that case the overlap is only adjacent, but here it is on any location...
    //          - In that case... we want to organize the groups so that the incidents of adjacent groups in the query set is small.
    //              - Ex, if we have, "pa" and "th", as our groups, we want to minimize the "at" type things, and certainly not create
    //                  and "at" group!
}

export function insertIntoCol<T extends SearchObject>(col: SearchCol<T>, elem: T, ignoreDuplicate?: boolean): void {
    let query = pathToQueryPath(elem.query);

    let pathHash = elem.query.pathHash;
    if(col.all.has(pathHash)) {
        if(ignoreDuplicate) return;
        throw new Error(`Duplicate insertion. When reusing a collection check with hasExact for all new values, and REMEMBER TO REMOVE OLD VALUES`);
    }
    col.all.set(pathHash, elem);

    if(!isNotQuery(query)) {
        col.queries.set(pathHash, query);
    }
    
    let histo = getHistogram(pathHash);

    for(let ch of histo.keys()) {
        let arr = col.buckets[ch] = col.buckets[ch] || [];
        let countBase = histo.get(ch);
        if(countBase === undefined) throw new Error(`Internal error`);
        let count = countBase;

        let index = bucketBinarySearch(arr, count, pathHash);
        if(index >= 0) {
            throw new Error(`Internal error, buckets and all are out of sync.`);
        }
        index = ~index;
        
        arr.splice(index, 0, {
            chCount: count,
            pathHash,
            elem,
            histo
        });
    }
}
export function removeFromCol<T extends SearchObject>(col: SearchCol<T>, elem: T): void {
    let pathHash = elem.query.pathHash;
    if(!col.all.has(pathHash)) {
        throw new Error(`Cannot remove element, it is not in collection. ${pathHash}`);
    }
    col.all.delete(pathHash);
    col.queries.delete(pathHash);
    
    let histo = getHistogram(pathHash);
    for(let ch of histo.keys()) {
        let list = col.buckets[ch];
        let index = bucketBinarySearch(list, histo.get(ch) || 0, pathHash);
        if(index < 0) {
            throw new Error(`Internal error, bucket out of sync with all`);
        }
        list.splice(index, 1);
    }
}

const pathQuerySymbol = Symbol("pathQuerySymbol");
// Any unicode character the user is unlikely to manually search for. I should really choose this better, but... this should be fine...
definePathSymbolName(pathQuerySymbol, "ç");

export function getPathQuery(path: PathQuery): EyeTypes.Path2 {
    // Hmm... I guess, always make the first part an array? To store type information? And then... after that...
    //  the other parts are for the path parts, and if they are an array it means they are a query.
    if(!Array.isArray(path)) {
        return pathFromArray([[ pathQuerySymbol as any, path.query ]]);
    }
    
    let result = pathFromArray([[pathQuerySymbol as any]].concat(path.map(x => typeof x === "object" ? [pathQuerySymbol, x.query] : [x])));

    pathToQueryPath(result);

    return result;
}

export function pathToQueryPath(path: EyeTypes.Path2): PathQuery {
    let pathArr = expandChildPaths(path);

    // Cast throughout the deal with readonly... because Array.isArray doesn't work well is readonly arrays.

    if(!Array.isArray(pathArr[0])) return path.path as any;

    if(pathArr[0][0] !== pathQuerySymbol as any) return path.path as any;

    if(pathArr.length === 1 && pathArr[0].length === 2) {
        if(typeof pathArr[0][1] !== "string") return path.path as any;
        return {
            query: pathArr[0][1]
        };
    }
    return pathArr.slice(1).map(pathPart => {
        if(!Array.isArray(pathPart)) {
            throw new Error(`Invalid query path, was it created with getPathQuery?`);
        }
        if(pathPart[0] === pathQuerySymbol) {
            if(typeof pathPart[1] === "string") {
                return { query: pathPart[1] };
            }
        }
        return pathPart[0];
    }) as any;
}

function isNotQuery(query: PathQuery): query is PropertyKey[] {
    return Array.isArray(query) && !query.some(x => typeof x !== "string");
}