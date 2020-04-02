import { UnionUndefined, min, max } from "./misc";
import { compareString } from "./algorithms";
import { ThrowIfNotImplementsData } from "pchannel";

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
    static readonly splitThreshold = 8;
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
        let beforeObj = this.findBefore(value, sumBefore as Sum);
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
            value: value,
            sumIncluded: sumIncluded,
            ["toList" as any]() {
                let parts: any[] = [];
                if(this.prev) {
                    parts.push("...");
                }
                let cur = this;
                while(true) {
                    parts.push(cur.value);
                    if(!cur.next) break;
                    cur = cur.next;
                }
                return parts;
            }
        };
        if(!this.valueRoot) {
            this.valueRoot = newNode;
            return;
        }
        if(beforeNode) {
            newNode.higher = beforeNode.higher;
            insertAfter(beforeNode, newNode);
        } else {
            newNode.higher = this.valueRoot.higher;
            insertBefore(this.valueRoot, newNode);
            this.valueRoot = newNode;
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
        sumBefore: Sum
    ): {
        beforeSum: Sum,
        beforeNode: ListNodeLeaf<Sum, Value>
    }|undefined {
        if(!this.valueRoot) return undefined;
        let root: ListNodeLeaf<Sum, Value>|ListNode<Sum, Value> = this.valueRoot;

        while(root.higher) root = root.higher;

        // NOTE: We call this.reduce more times than absolutely needed if this find is for an insertion,
        //  rebalancing requiring a similar algorithm, which calls reduce and gets pretty much the same values.
        //  But... combining the two algorithms is difficult...

        let cur: ListNodeLeaf<Sum, Value>|ListNode<Sum, Value>|undefined = undefined;
        let curSum: Sum|undefined = undefined;
        while(true) {
            while(true) {
                let next: ListNodeLeaf<Sum, Value>|ListNode<Sum, Value>|undefined = cur ? cur.next : root;
                if(!next) {
                    break;
                }
                let nextSumBefore = this.reduce(curSum, next.sumIncluded);
                let diff = this.compare(
                    { sumBefore: nextSumBefore, value: next.value },
                    { sumBefore: sumBefore, value: value }
                );
                // If the next value is > us, then we are inside the current range, and so should stay there.
                if(diff > 0) {
                    break;
                }
                curSum = nextSumBefore;
                cur = next;
            }

            if(!cur) {
                // We are before the first value, and so should insert before everything.
                return undefined;
            }
            else if("lower" in cur) {
                cur = (cur as any).lower;
            } else {
                if(!curSum) throw new Error(`Internal error, impossible, curSum and prevNode are set at the same time.`);
                return { beforeSum: curSum, beforeNode: cur };
            }
        }
    }


    // Called on leaf node when it is inserted (after it is inserted into the list, preserving next/prev, and setting a higher,
    //  which may be invalid (as in the higher may be > the node)).
    private rebalanceNode(listNode: ListNode<Sum, Value>|ListNodeLeaf<Sum, Value>) {

        let higherNodes: ListNode<Sum, Value>[] = [];

        let higher = listNode.higher;

        let start = listNode;
        while(true) {
            let prev = start.prev;
            if(!prev) break;
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

        // We might have to remove the top node, if it is the only one, and doesn't have enough children.
        if(siblingCount === 1 && "lower" in start) {
            let childCount = 0;
            {
                let cur = UnionUndefined(start.lower);
                while(cur) {
                    childCount++;
                    cur = cur.next;
                }
            }
            if(childCount < SkipList.joinThreshold) {
                let child = start.lower;
                // Just remove all higher referencses to us, and then... our node should just go away...
                while(true) {
                    child.higher = undefined;
                    if(!child.next) break;
                    child = child.next;
                }
            }
            // Always return, if we only have one node, there is no more balancing or maintenance to do.
            return;
        }
        
        // Check for joining
        if(siblingCount < SkipList.joinThreshold) {
            // Extend our end to include the next group of sibling. As we reset the higher value
            //  for our children, this will disconnect the previous highest node, which will eventually
            //  result in it being garbage collected. We might recreate a new node in the same location, but...
            //  it is likely the new position (if we do add another highest node) will change.
            let nextHigher = end?.higher;
            if(nextHigher) {
                this.removeNode(nextHigher);
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
                        let prevHigherList = higher;
                        higher = {
                            lower: cur,
                            higher: undefined,
                            next: undefined,
                            prev: undefined,
                            // as any cast is fine, we will set it shortly.
                            sumIncluded: undefined as any,
                            value: cur.value,
                        };
                        
                        if(prevHigherList) {
                            insertAfter(prevHigherList, higher);
                        }
                    }
                }
                
                if(cur.higher && cur.higher.lower === cur) {
                    higherNodes.push(cur.higher);
                }

                if(higher) {
                    higher.sumIncluded = this.reduce(higher.sumIncluded, cur.sumIncluded);
                }

                cur.higher = higher;
                cur = cur.next;
                count++;
            }
        }

        // And we have to rebalance any touched parent nodes, at to update directChildCount, their sums, and maybe rebalance.
        for(let changedHigher of higherNodes) {
            this.rebalanceNode(changedHigher);
        }
    }

    // Rebalancing is required after running this.
    private removeNode(node: ListNode<Sum, Value> | ListNodeLeaf<Sum, Value>) {
        if(node === this.valueRoot) {
            this.valueRoot = node.next;
        }
        removeNode(node);
        if(node.higher && node.higher.lower === node) {
            this.removeNode(node.higher);
        }
    }

    public getSumBefore(value: Value): Sum|undefined {
        let beforeObj = this.findBefore(value, undefined as any);
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
        let beforeObj = this.findBefore(undefined as any as Value, sumBefore);

        let curSum = beforeObj?.beforeSum;
        let start = beforeObj?.beforeNode || this.valueRoot;

        let valueNodes: ListNodeLeaf<Sum, Value>[] = [];

        while(start) {
            valueNodes.push(start);
            curSum = this.reduce(curSum, start.sumIncluded);
            let diff = this.compare({ value: undefined as any, sumBefore: sumBeforeEnd }, { value: undefined as any, sumBefore: curSum });
            if(diff < 0) {
                break;
            }
            start = start.next;
        }

        let newValueNodes = reduce(beforeObj?.beforeSum, valueNodes);
        
        // Rebalance starting from the first group removed, or the root if there is no group.
        let rebalanceBase = valueNodes.length > 0 && valueNodes[0].higher?.lower || this.valueRoot;

        for(let valueNode of valueNodes) {
            this.removeNode(valueNode);
        }
        
        let prev = beforeObj?.beforeNode;
        for(let newValue of newValueNodes) {
            let newNode = this.addNodeInternal(newValue.value, newValue.sumIncluded, prev);
            prev = newNode;
        }

        if(rebalanceBase) {
            this.rebalanceNode(rebalanceBase);
        }
    }

    public getAllNodes(): { sumIncluded: Sum, value: Value }[] {
        let values: { sumIncluded: Sum, value: Value }[] = [];
        let cur = this.valueRoot;
        while(cur) {
            values.push(cur);
            if(!cur.next) break;
            cur = cur.next;
        }
        return values;
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
}


interface ListNode<Sum, V> extends ListNodeBase<ListNode<Sum, V>> {
    // lower.higher === this, always
    lower: ListNode<Sum, V>|ListNodeLeaf<Sum, V>;
    // If higher && higher.lower === this, then we are a fixed node, and cannot be removed.
    higher: ListNode<Sum, V>|undefined;
    sumIncluded: Sum;
    value: V;
}
interface ListNodeLeaf<Sum, V> extends ListNodeBase<ListNodeLeaf<Sum, V>> {
    higher: ListNode<Sum, V>|undefined;
    sumIncluded: Sum;
    value: V;
}



//todonext;
// Test SkipList
//  Sum
//  Min
//  Max
//  Count
//if(false as boolean)
{
    let sumList = new SkipList<{ sortOrder: string; }, { sum: number }>(
        (a, b) => ({ sum: a.sum + b.sum }),
        (lhs, rhs) => compareString(lhs.value.sortOrder, rhs.value.sortOrder)
    );

    sumList.addNode({ sortOrder: "a" }, { sum: 2 });
    sumList.addNode({ sortOrder: "b" }, { sum: 1 });
    sumList.addNode({ sortOrder: "c" }, { sum: 3 });
    sumList.addNode({ sortOrder: "k" }, { sum: -2 });
    sumList.addNode({ sortOrder: "q" }, { sum: 1 });

    ThrowIfNotImplementsData(sumList.getSumBefore({ sortOrder: "e" })?.sum, 6);

    sumList.addNode({ sortOrder: "ba" }, { sum: 1 });
    sumList.addNode({ sortOrder: "aa" }, { sum: 1 });

    ThrowIfNotImplementsData(sumList.getSumBefore({ sortOrder: "ba" })?.sum, 4);
}