import { UnionUndefined, min, max, globalNextId } from "./misc";
import { compareString } from "./algorithms";
import { ThrowIfNotImplementsData, g } from "pchannel";
import { exposedLookupsDisplayInfo } from "../debugUtils/exposeDebug";

// TODO: I think for this to be useful we need a way to split values, which happens when values compare ===.
//  We would use it for our index thing, to first add a value that is basically a range of unchanged elements.
//  ALSO, when we compare, we need to give current Node+SumNode, and the new Node.
//  Then when we match an unchanged range, we will call some split function, which will turn the unchange range
//  into three ranges, two unchanged, and one changd. We will even be able to combine changed ranges, giving
//  us a full index lookup, that can always trace back to unchange values. And because we know when values change,
//  we can even have an efficient lookup to just get unchanged (or changed) values, already reduced.
//  Although... before I even think of implementing that, I have to come up with other cases when it would be useful,
//  as right now it doesn't seem like it would even be used that often...

/** SkipList.
 *  - Works with no global sort key (which is required when the global sort key doesn't exist, because order
 *      depends in insertion order), which is a really nice property.
 *  - Expected O(N) space, O(logN) time.
 *      - Worst case behavior is not relevant, as it is only obtained if the list randomly becomes poorly balanced
 *          (too many tiers, or too few tiers), which is statistically improbable on very large lists, and not
 *          an attack vector (as long as the PRNG is not attackable).
 * */
export class SkipList<Value, Sum> {
    constructor(
        private reduceSumNodes: (lhs: Sum, rhs: Sum) => Sum,
        /** Compare is given both the values and sums, so it can choose which one it wants to sort by.
         *      Sorting by sum may seem odd, but that is exactly how an array works. As to how the user would
         *      find sumBefore in the first place, well a sorted array is sorted by index, AND by sort key.
         *      So given a size, a binary search can search us for a value in an array without accessing most
         *      value, and pass in the sumBefore while inserting. This list doesn't perform the binary search
         *      for you though, because our purpose is to provide range queries, which needs to exist under
         *      the binary search (or not binary search, if the list isn't sorted, and is organized in some other way).
         * 
         * NOTE: Comparisons only matter upon insertion, after which we don't do any sorting, as in the array case,
         *      any sort order is valid, and the sumBefore passed in with insertion will only be valid once.
        */
        private compare: (
            lhs: { value: Value; sumBefore: Sum },
            rhs: { value: Value; sumBefore: Sum },
        ) => number,
    ) { }

    
    // We split SumNodes when > splitThreshold
    static readonly splitThreshold = 4;
    // We join SumNodes when < joinThreshold
    static readonly joinThreshold = 2;

    // The gap between the split/join thresholds prevents thrashing, which happens if there is a single threshold, and you repeatedly remove/insert
    //  to go back and forth from that boundary.
    //  The factor should be greater than 2, as once we split, the size divides by 2, and we don't want to quickly join again...


    // TODO: We could take our linked listed and implement them with an abstract linked list format, which uses arrays for
    //  small cases. This would make some cases very fast, as iterating over arrays is much faster.
    //  - If this is implemented in C, at the very least list nodes should be put into groups, where each level
    //      has it's own group. That way at least the first few levels can be in the same memory pages.
    valueRoot: ListNodeLeaf<Sum, Value>|undefined = undefined;


    // NOTE: If sumBefore is undefined, it is assumed that sorting won't require sumBefore
    //  and undefined will be passed to compare in place of sumBefore.
    public addNode(value: Value, sumIncluded: Sum, sumBefore?: Sum): void {
        let beforeObj = this.findBefore(value, sumBefore as Sum, sumBefore !== undefined);
        let newNode = this.addNodeInternal(value, sumIncluded, beforeObj?.beforeNode);
        if(newNode) {
            this.rebalanceNode(newNode);
        }
    }

    public addNodeInternal(value: Value, sumIncluded: Sum, beforeNode: ListNodeLeaf<Sum, Value>|undefined) {
        let newNode: ListNodeLeaf<Sum, Value> = {
            higher: undefined,
            next: undefined,
            prev: undefined,
            lastValue: value,
            sumIncluded: sumIncluded,
            id: globalNextId()
        };
        if(!this.valueRoot) {
            this.valueRoot = newNode;

            if(typeof this.valueRoot?.next === "string") {
                debugger;
            }

            return newNode;
        }
        if(beforeNode) {
            newNode.higher = beforeNode.higher;
            insertAfter(beforeNode, newNode);
        } else {
            if(typeof this.valueRoot.next === "string") {
                debugger;
            }
            insertBefore(this.valueRoot, newNode);
            newNode.higher = this.valueRoot.higher;
            if(newNode.higher) {
                newNode.higher.lower = newNode;
            }
            this.valueRoot = newNode;
        }

        if(typeof this.valueRoot?.next === "string") {
            debugger;
        }

        return newNode;
    }

    private reduce(lhs: Sum|undefined, rhs: Sum): Sum {
        if(!lhs) return rhs;
        return this.reduceSumNodes(lhs, rhs);
    }

    /** Finds the first node before input node. Strictly <, === values are not returned. */
    private findBefore(
        value: Value,
        sumBefore: Sum,
        // I think this should be true when you are iterating over ranges, as we essentially compare the end of the range, and so including equal
        //  for the end of the range is most correct?
        includeEqual: boolean
    ): {
        // The sum, included beforeNode, before sumBefore.
        beforeSum: Sum,
        beforeNode: ListNodeLeaf<Sum, Value>
    }|undefined {
        if(!this.valueRoot) return undefined;
        let root: ListNodeLeaf<Sum, Value>|ListNode<Sum, Value> = this.valueRoot;

        while(root.higher) root = root.higher;

        // NOTE: We call this.reduce more times than absolutely needed if this find is for an insertion,
        //  rebalancing requiring a similar algorithm, which calls reduce and gets pretty much the same values.
        //  But... combining the two algorithms is difficult...

        let cur: ListNodeLeaf<Sum, Value>|ListNode<Sum, Value>|undefined = root;
        let prev: ListNodeLeaf<Sum, Value>|ListNode<Sum, Value>|undefined = undefined;
        let prevSum: Sum|undefined = undefined;

        while(cur) {
            let curSum = this.reduce(prevSum, cur.sumIncluded);
            let diff = this.compare(
                { sumBefore: curSum, value: cur.lastValue },
                { sumBefore: sumBefore, value: value }
            );
            if(diff > 0 || !includeEqual && diff === 0 || "lower" in cur || !cur.next) {
                if("lower" in cur) {
                    if(prev) {
                        if(!("lower" in prev)) throw new Error(`Internal error, cur and prev are the same type, this is unreachable`);
                        prev = (prev as any).lower;
                        if(!prev || !prev.next) {
                            throw new Error(`Internal error, higher level has a prev.next, but lower level doesn't? Impossible.`);
                        }
                        // Oh, we... need to go the end of the prev list. Could be done better with cur.lower.prev, but
                        //  sometimes we don't have a cur.
                        while(prev.next && prev.next.higher === prev.higher) {
                            prev = prev.next;
                        }
                        cur = prev.next;
                        
                        continue;
                    } else {
                        if(!cur.prev && cur.lower.prev) {
                            // Our validate should catch this, but it isn't?
                            this.validateAllNodes("wtf");
                            debugger;

                            throw new Error(`Internal error, the current has no previous, and we appear to be at the start of a group, but... there is a group before our lower.`);
                        }

                        // Go down from cur
                        cur = cur.lower;
                    }
                } else {
                    if(diff < 0 || includeEqual && diff === 0) {
                        // Then we got here because there is no next, so we actually want to current the current values
                        return { beforeNode: cur, beforeSum: curSum };
                    }
                    if(!prev || !prevSum) return undefined;
                    return { beforeNode: prev, beforeSum: prevSum };
                }
            } else {
                prev = cur;
                prevSum = curSum;
                cur = cur.next;
            }
        }
        return undefined;
    }


    // Called on leaf node when it is inserted (after it is inserted into the list, preserving next/prev, and setting a higher,
    //  which may be invalid (as in the higher may be > the node)).
    private rebalanceNode(listNode: ListNode<Sum, Value>|ListNodeLeaf<Sum, Value>) {

        let higherNodes: ListNode<Sum, Value>[] = [];

        let higher = listNode.higher;

        if(higher && !higher.prev && higher.lower.prev) {
            debugger;
            throw new Error(`Higher is messed up`);
        }

        let start = listNode;
        while(true) {
            let prev = start.prev;
            if(!prev) break;
            // If there is no previous higher, then it should implicitly take ours
            if(higher && !prev.higher) {
                prev.higher = higher;
            }
            if(prev.higher !== higher) break;
            start = prev;
        }

        let siblingCount = 0;
        let end: ListNode<Sum, Value>|ListNodeLeaf<Sum, Value>|undefined = start;

        // Count siblings
        {
            while(true) {
                siblingCount++;
                end = end.next;
                if(!end || end.higher !== higher) break;
            }
        }

        if(typeof (start as any) === "string") {
            debugger;
        }
        
        // Check for joining
        if(siblingCount < SkipList.joinThreshold) {
            // Extend our end to include the next group of sibling. As we reset the higher value
            //  for our children, this will disconnect the previous highest node, which will eventually
            //  result in it being garbage collected. We might recreate a new node in the same location, but...
            //  it is likely the new position (if we do add another highest node) will change.
            let nextHigher = end?.higher;
            if(nextHigher) {
                //debugger;
                //console.log("before remove node join", this.stringifyTree());
                // We remove nextHigher, but leave the references from their children to the nextHigher. Which is okay,
                //  as we will be iterating over the children and resetting their higher reference shortly
                this.removeNode(nextHigher);
                //console.log("after remove node join", this.stringifyTree());
                //this.validateAllNodes();


                while(end && end.higher === nextHigher) {
                    end = end.next;
                    siblingCount++;
                }
            }
        }

        let splitThreshold = SkipList.splitThreshold;

        // Update all higher values, and sumIncludes for higher nodes.
        {
            let cur = UnionUndefined(start);
            let higher = start.higher;
            if(higher) {
                // as any cast is fine, we will set it shortly.
                higher.sumIncluded = undefined as any;
            }
            let count = 0;
            while(cur && cur !== end) {

                if(siblingCount > splitThreshold) {
                    // if splitThreshold == 8, count == 9, this will match at count % 4 == 1, count > 4, so 5, and 9.
                    let isSplitPoint = count > splitThreshold / 2 && count % (splitThreshold / 2) === siblingCount % (splitThreshold / 2);
                    if(isSplitPoint || !higher) {
                        // If we are splitting, then this will be the higher for the previous part of the split, and so be correct.
                        // If we have no higher, then it means we are at the top of the tree, and so this will be undefined, which is fine,
                        //  because then there is no higher list to add this to.
                        // (And the "height" of all higher chains are at the same level, it means if we don't have a higher node, nothing
                        //  on our level can either).
                        let prevHigherList = higher;
                        higher = {
                            lower: cur,
                            higher: prevHigherList && prevHigherList.higher,
                            next: undefined,
                            prev: undefined,
                            // as any cast is fine, we will set it shortly.
                            sumIncluded: undefined as any,
                            lastValue: cur.lastValue,
                            id: globalNextId()
                        };
                        
                        if(prevHigherList) {
                            insertAfter(prevHigherList, higher);
                        }
                    }
                } else if(count === 0) {
                    if(higher) {
                        if(!higher.prev && cur.prev) {
                            debugger;
                            throw new Error(`Internal error, the current higher has no previous, and we appear to be at the start of a group, but... there is a group before us. So does the group before us have no higher (which is invalid), or what?`);
                        }
                        higher.lower = cur;
                    }
                }

                if(higher && !higher.prev && higher.lower.prev) {
                    debugger;
                    throw new Error(`Higher is messed up`);
                }
                
                if(higher && higher.lower === cur) {
                    higherNodes.push(higher);
                }

                if(higher) {
                    higher.sumIncluded = this.reduce(higher.sumIncluded, cur.sumIncluded);
                    higher.lastValue = cur.lastValue;
                }

                cur.higher = higher;
                cur = cur.next;
                count++;
            }
        }

        if(higher && !higher.prev && higher.lower.prev) {
            debugger;
            throw new Error(`Higher is messed up`);
        }

        // And we have to rebalance any touched parent nodes, at to update directChildCount, their sums, and maybe rebalance.
        for(let changedHigher of higherNodes) {
            this.rebalanceNode(changedHigher);
        }
    }


    // Rebalancing is required after running this
    private removeNode(node: ListNode<Sum, Value> | ListNodeLeaf<Sum, Value>) {
        let nodeNext = node.next;
        if(node === this.valueRoot && !("lower" in node)) {
            this.valueRoot = nodeNext;
        }
        // Update our children to point to a new higher value.
        if("lower" in node) {
            let replacement = node.next;
            if(replacement) {
                // And if we are making the next use our higher, then the lower should be our lower too
                replacement.lower = node.lower;
            }
            if(!replacement) {
                replacement = node.prev;
            }
            let cur = UnionUndefined(node.lower);
            while(cur && cur.higher === node) {
                cur.higher = replacement;
                cur = cur.next;
            }
        }

        // If we are the key node, and have siblings, make the next node the new key node
        let curHigher = node.higher;
        if(curHigher && curHigher.lower === node) {
            if(nodeNext) {
                curHigher.lower = nodeNext;
            }
            if(nodeNext && nodeNext.higher === curHigher) {
                // If we have siblings, then we can keep the higher node, just make it use the next node as the lower value
                curHigher.lower = nodeNext;
            } else {
                // If we are in an empty group, remove our higher value.
                this.removeNode(curHigher);
            }
        }

        removeNode(node);
        

        if(typeof this.valueRoot?.next === "string") {
            debugger;
        }
    }

    public getSumBefore(value: Value): Sum|undefined {
        let beforeObj = this.findBefore(value, undefined as any, false);
        let before = beforeObj ? beforeObj.beforeSum : undefined;
        return before;
    }

    // NOTE: Create a version which uses Value, and maybe a version which takes both?

    /** Passes undefined as the Value to the compare function. */
    public mutateSumRange(
        sumBefore: Sum,
        sumBeforeEnd: Sum,
        reduce: (
            sumBeforeFirstValue: Sum|undefined,
            values: { sumIncluded: Sum, value: Value }[]
        ) => { sumIncluded: Sum, value: Value }[]
    ): void {
        // Include equal, as... this basically means the end of the range equals overlaps with sumBefore, which means it is before our value,
        //  which is what we want. 
        let beforeObj = this.findBefore(undefined as any as Value, sumBefore, true);

        // Because we don't necessarily track a "startSum" for nodes, it means this.valueRoot has to "start" at some kind of 0 point.
        //  This means sumBefore and sumBeforeEnd can't be before it, so if nothing is before sumBefore, then we can assume valueRoot is
        //  at least overlapping with sumBefore.

        let cur = beforeObj?.beforeNode.next;
        if(!beforeObj) {
            cur = this.valueRoot;
        }
        let firstSumBefore = beforeObj?.beforeSum || undefined;
        let curSumBefore = firstSumBefore;

        let valueNodes: ListNodeLeaf<Sum, Value>[] = [];

        while(cur) {
            curSumBefore = this.reduce(curSumBefore, cur.sumIncluded);
            valueNodes.push(cur);

            cur = cur.next;
            if(!cur) break;
            
            let diff = this.compare({ value: undefined as any, sumBefore: sumBeforeEnd }, { value: undefined as any, sumBefore: curSumBefore });
            if(diff < 0) {
                break;
            }
        }

        let newValueNodes = reduce(firstSumBefore, valueNodes.map(x => ({ sumIncluded: x.sumIncluded, value: x.lastValue })));

        for(let i = 0; i < valueNodes.length; i++) {
            let valueNode = valueNodes[i];
            this.removeNode(valueNode);
        }


        let prev = beforeObj?.beforeNode;
        for(let newValue of newValueNodes) {
            let newNode = this.addNodeInternal(newValue.value, newValue.sumIncluded, prev);
            prev = newNode;
        }

        // Rebalance starting from the start of the previous group (we could also take the start of the group of the first newNode,
        //  if we added any new nodes).
        let rebalanceBase = beforeObj?.beforeNode || this.valueRoot;
        while(rebalanceBase && rebalanceBase.prev && rebalanceBase.prev.higher === rebalanceBase.higher) {
            rebalanceBase = rebalanceBase.prev;
        }

        if(rebalanceBase) {
            this.rebalanceNode(rebalanceBase);
        }
    }

    public getAllNodes(): { sumIncluded: Sum, value: Value }[] {
        let values: { sumIncluded: Sum, value: Value }[] = [];
        let cur = this.valueRoot;
        while(cur) {
            values.push({ sumIncluded: cur.sumIncluded, value: cur.lastValue });
            if(!cur.next) break;
            cur = cur.next;
        }
        return values;
    }

    public validateAllNodes(id: string="") {
        
        // Make sure following the higher references always gives the same height... or else we are missing some...
        let height = -1;
        {
            let cur = this.valueRoot;
            while(cur) {
                height++;
                cur = cur.higher;
            }
        }

        let cur: ListNode<Sum, Value>|ListNodeLeaf<Sum, Value>|undefined;
        cur = this.valueRoot;
        let depth = 0;
        while(cur) {
            let curHigher: ListNode<Sum, Value>|undefined = cur?.higher;
            let index = 0;
            while(cur) {
                let higher = cur.higher;

                if(higher) {
                    if(typeof higher.next === "string") {
                        debugger;
                        console.log("broken tree\n", this.stringifyTree());
                        debugger;
                        throw new Error(`Disposed value in higher next ${depth} ${index}`);
                    }
                    if(typeof higher.prev === "string") {
                        debugger;
                        throw new Error(`Disposed value in higher prev`);
                    }
                } else {
                    if(depth !== height) {
                        console.log("broken tree\n", this.stringifyTree());
                        debugger;
                        throw new Error(`Not enough height, got ${depth}, should be ${height}`);
                    }
                }

                if(higher && !higher.prev && higher.lower.prev) {
                    console.log(this.stringifyTree());
                    debugger;
                    throw new Error(`Higher is messed up, ${id}, ${depth}, ${index}`);
                }
                if("lower" in cur) {
                    if(!(cur as any).prev && (cur as any).lower.prev) {
                        debugger;
                        throw new Error(`Our lower values go before us, which should be impossible`);
                    }
                }

                if(typeof cur.next === "string") {
                    debugger;
                    throw new Error(`Disposed value in next`);
                }
                if(typeof cur.prev === "string") {
                    debugger;
                    throw new Error(`Disposed value in prev`);
                }

                cur = cur.next;
                index++;
            }
            cur = curHigher;
            depth++;
        }
    }

    private stringifyList(start: ListNode<Sum, Value>|ListNodeLeaf<Sum, Value>): string {
        let parts: string[] = [];
        let cur = UnionUndefined(start);
        while(cur) {
            let curStr = cur.id + "";
            if("lower" in cur) {
                curStr += "_" + cur.lower.id;
            }
            if(cur.higher) {
                curStr += "^" + cur.higher.id;
                if(typeof cur.higher.next === "string") {
                    curStr += "{PARENT_IS_DISPOSED}";
                }
            }
            
            parts.push(curStr);

            cur = cur.next;
        }
        return parts.join("    ");
    }
    private stringifyTree(): string {
        let root = this.valueRoot;
        let parts: string[] = [];
        while(root) {
            parts.push(this.stringifyList(root));
            root = root.higher;
        }
        parts.reverse();
        return parts.join("\n");
    }
}

interface ListNodeBaseBase {
    prev: ListNodeBaseBase|undefined;
    next: ListNodeBaseBase|undefined;
}
interface ListNodeBase<T extends ListNodeBase<T> = ListNodeBaseBase> {
    prev: T|undefined;
    next: T|undefined;
}

function insertBefore<T extends ListNodeBase<T>>(curListNode: T, newListNode: T) {
    newListNode.next = curListNode;
    newListNode.prev = curListNode.prev;

    if(curListNode.prev) {
        curListNode.prev.next = newListNode;
    }
    curListNode.prev = newListNode;
}
function insertAfter<T extends ListNodeBase<T>>(curListNode: T, newListNode: T) {
    newListNode.prev = curListNode;
    newListNode.next = curListNode.next;

    if(curListNode.next) {
        curListNode.next.prev = newListNode;
    }
    curListNode.next = newListNode;
}
function removeNode<T extends ListNodeBase<T>>(listNode: T) {
    if(listNode.prev) {
        listNode.prev.next = listNode.next;
    }
    if(listNode.next) {
        listNode.next.prev = listNode.prev;
    }
    // Just to make sure if we access it again, we will throw.
    listNode.prev = "disposed" as any;
    listNode.next = "disposed" as any;
    
    //listNode.prev = new Error().stack as any;
}


interface ListNode<Sum, V> extends ListNodeBase<ListNode<Sum, V>> {
    // lower.higher === this, always
    lower: ListNode<Sum, V>|ListNodeLeaf<Sum, V>;
    // If higher && higher.lower === this, then we are a fixed node, and cannot be removed.
    higher: ListNode<Sum, V>|undefined;
    sumIncluded: Sum;
    lastValue: V;
    id: number;
}
interface ListNodeLeaf<Sum, V> extends ListNodeBase<ListNodeLeaf<Sum, V>> {
    higher: ListNode<Sum, V>|undefined;
    sumIncluded: Sum;
    lastValue: V;
    id: number;
}

export function linkedListToList<T extends ListNodeBase<T>>(list: T|undefined): T[] {
    let arr: T[] = [];
    while(list?.prev) {
        list = list.prev;
    }
    while(list) {
        arr.push(list);
        list = list.next;
    }
    return arr;
}