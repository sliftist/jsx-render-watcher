import { UnionUndefined } from "./misc";

/** SkipList.
 *  - Works with no global sort key (which is required when the global sort key doesn't exist, because order
 *      depends in insertion order), which is a really nice property.
 *  - Expected O(N) space, O(logN) time.
 *      - Worst case behavior is not relevant, as it is only obtained if the list randomly becomes poorly balanced
 *          (too many tiers, or too few tiers), which is statistically improbable on very large lists, and not
 *          an attack vector (as long as the PRNG is not attackable).
 * */
export class SkipList<Value, SumNode> {
    constructor(
        private reduceSumNodes: (lhs: SumNode, rhs: SumNode) => SumNode,
        /** Compares against reduced sumNode, that is the summary of all sum nodes before. */
        private compare: (sum: SumNode, node: Value) => number,
        private getSum: (node: Value) => SumNode
    ) { }

    
    // We split SumNodes when > splitThreshold
    static readonly splitThreshold = 10;
    // We join SumNodes when < joinThreshold
    static readonly joinThreshold = 5;

    // The gap between the split/join thresholds prevents thrashing, which happens if there is a single threshold, and you repeatedly remove/insert
    //  to go back and forth from that boundary.


    // TODO: We could take our linked listed and implement them with an abstract linked list format, which uses arrays for
    //  small cases. This would make some cases very fast, as iterating over arrays is much faster.
    //  - If this is implemented in C, at the very least list nodes should be put into groups, where each level
    //      has it's own group. That way at least the first few levels can be in the same memory pages.
    valueRoot: ListNodeLeaf<SumNode, Value>|undefined = undefined;

    public addNode(node: Value): void {
        let beforeObj = this.findBefore(node);
        let sum = this.getSum(node);
        let newNode: ListNodeLeaf<SumNode, Value> = {
            higher: undefined,
            next: undefined,
            prev: undefined,
            node,
            value: sum
        };
        if(!this.valueRoot) {
            this.valueRoot = newNode;
            return;
        }
        let before = beforeObj ? beforeObj.beforeNode : this.valueRoot;
        insertBefore(before, newNode);
        newNode.higher = before.higher;

        this.rebalanceNode(newNode, node);
    }

    public removeNode(node: Value) {
        if(!this.valueRoot) return;
        let beforeObj = this.findBefore(node);
        let afterAt = beforeObj ? beforeObj.beforeNode.next : this.valueRoot;

        if(afterAt && afterAt.node === node) {
            let next = afterAt.next;
            removeNode(afterAt);
            if(this.valueRoot === next) {
                this.valueRoot = next;
            }
        }
    }

    private reduce(lhs: SumNode|undefined, rhs: SumNode): SumNode {
        if(!lhs) return rhs;
        return this.reduceSumNodes(lhs, rhs);
    }

    /** Finds the first node before input node. Strictly <, === values are not returned. */
    private findBefore(
        node: Value
    ): {
        beforeSum: SumNode,
        beforeNode: ListNodeLeaf<SumNode, Value>
    }|undefined {
        if(!this.valueRoot) return undefined;
        let root: ListNodeLeaf<SumNode, Value>|ListNode<SumNode, Value> = this.valueRoot;

        while(root.higher) root = root.higher;

        // NOTE: We call this.reduce more times than absolutely needed if this find is for an insertion,
        //  AND we need to rebalance. However, as we don't need to rebalance 

        let cur = root;
        let curSum: SumNode|undefined = undefined;
        while(true) {
            let prevNode: ListNodeLeaf<SumNode, Value>|ListNode<SumNode, Value>|undefined = undefined;
            while(true) {
                let nextSum = this.reduce(curSum, cur.value);
                if(this.compare(nextSum, node) > 0) {
                    break;
                }
                curSum = nextSum;
                prevNode = cur;
                if(!cur.next) break;
                cur = cur.next;
            }

            if(!prevNode) {
                // Beginning, as all higher parts of the tree run directly to the base, so if this is before
                //  of the top of the tree, it is before the base.
                return undefined;
            } else {
                if("lower" in prevNode) {
                    cur = prevNode.lower;
                } else {
                    if(!curSum) throw new Error(`Internal error, impossible, curSum and prevNode are set at the same time.`);
                    return { beforeSum: curSum, beforeNode: prevNode };
                }
            }
        }
    }


    // Called on leaf node when it is inserted (after it is inserted into the list, preserving next/prev, and setting a higher,
    //  which may be invalid (as in the higher may be > the node)).
    private rebalanceNode(listNode: ListNode<SumNode, Value>|ListNodeLeaf<SumNode, Value>, nodeForBeginningInsertCheck: Value) {

        let rebalanceParents = false;
        let rebalanceStart: ListNode<SumNode, Value>|ListNodeLeaf<SumNode, Value> = listNode;
        let rebalanceSplitPosition = Number.MAX_SAFE_INTEGER;
        let rebalanceEnd: ListNode<SumNode, Value>|ListNodeLeaf<SumNode, Value>|undefined;


        // There will be at most 2 nodes in this array. Serious deja vu.
        let changedHigherNodes: ListNode<SumNode, Value>[] = [];


        let siblingCount = 0;
        let higher = listNode.higher;
        if(!higher) {
            // We are at the top of the tree, so... we need to count siblings ourself...
            let cur = listNode;
            while(cur.prev) { cur = cur.prev; }
            rebalanceStart = cur;
            let count = 0;
            while(cur) { count++; if(!cur.next) break; cur = cur.next; }
            siblingCount = count;

            // We might have to remove the top node, if it is the only one, and doesn't have enough children.
            if(siblingCount === 1 && "lower" in listNode && listNode.directChildCount < SkipList.joinThreshold) {
                let child = listNode.lower;
                // Just remove all higher referencses to it, and then... it should just go away.
                while(true) {
                    child.higher = undefined;
                    if(!child.next) break;
                    child = child.next;
                }
                return;
            }
        } else {
            // Check to see if there was an insert before a higher node, as this requires us to move the higher node.
            // TODO: This comparison is actually only needed once, and then we can pass a flag up, that only gets reset
            //  once we stop following the same higher node.
            if(this.compare(higher.value, nodeForBeginningInsertCheck) < 0) {
                rebalanceParents = true;
            }
            siblingCount = higher.directChildCount;
            rebalanceEnd = higher.next && higher.next.lower;
        }

        if(!rebalanceParents) {
            if(siblingCount > SkipList.splitThreshold) {
                rebalanceSplitPosition = Math.floor(siblingCount / 2);
                rebalanceParents = true;
            }
            else if(siblingCount < SkipList.joinThreshold) {
                let nextHigher = higher && higher.next;
                if(higher && nextHigher) {
                    rebalanceEnd = nextHigher && nextHigher.lower;
                    rebalanceParents = true;

                    if(nextHigher.directChildCount + higher.directChildCount > SkipList.splitThreshold) {
                        // Then this is just a rebalance, not a join
                        rebalanceSplitPosition = Math.floor((nextHigher.directChildCount + higher.directChildCount) / 2);
                    } else {
                        // A true join, the nextHigher node will be removed.
                        removeNode(nextHigher);
                        changedHigherNodes.push(nextHigher);
                    }
                }
            }
        }

        
        let cur = UnionUndefined(rebalanceStart);
        let higherList = rebalanceStart.higher;

        if(higherList) {
            // any cast is fine... we will fix .value shortly...
            higherList.value = undefined as any;
            higherList.directChildCount = 0;
            changedHigherNodes.push(higherList);
        }

        let count = 0;
        while(cur && cur !== rebalanceEnd) {
            if(!higherList && rebalanceParents || count === rebalanceSplitPosition) {
                // Either growing the top of the tree (if !higherList), or splitting
                let prevHigherList = higherList;
                higherList = {
                    directChildCount: 0,
                    lower: listNode,
                    higher: undefined,
                    next: undefined,
                    prev: undefined,
                    // Eh... this is fine, it will be replaced later
                    value: undefined as any,
                };
                changedHigherNodes.push(higherList);
                if(prevHigherList) {
                    insertAfter(prevHigherList, higherList);
                }
            }

            if(higherList) {
                higherList.value = this.reduce(higherList.value, cur.value);
                higherList.directChildCount++;
            }

            cur.higher = higherList;

            count++;
            cur = cur.next;
        }

        // And we have to rebalance any touched parent nodes, at to update directChildCount, their sums, and maybe rebalance.
        for(let changedHigher of changedHigherNodes) {
            this.rebalanceNode(changedHigher, nodeForBeginningInsertCheck);
        }
    }

    public getSums(node: Value): {
        before: SumNode|undefined;
    } {
        let beforeObj = this.findBefore(node);
        let before = beforeObj ? beforeObj.beforeSum : undefined;
        return { before };
    }

    public getNodes(): Value[] {
        let values: Value[] = [];
        let cur = this.valueRoot;
        while(cur) {
            values.push(cur.node);
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

interface ValueListNode<T> {
    value: T;
}

interface ChildCounter {
    directChildCount: number;
}

interface ListNode<T, V> extends ValueListNode<T>, ListNodeBase<ListNode<T, V>>, ChildCounter {
    // lower.higher === this, always
    lower: ListNode<T, V>|ListNodeLeaf<T, V>;
    // If higher && higher.lower === this, then we are a fixed node, and cannot be removed.
    higher: ListNode<T, V>|undefined;
}
interface ListNodeLeaf<T, V> extends ValueListNode<T>, ListNodeBase<ListNodeLeaf<T, V>> {
    higher: ListNode<T, V>|undefined;
    node: V;
}