import { g } from "pchannel";

interface AATreeNode<T, Reduced> {
    value: T;

    reduced: Reduced;

    left: AATreeNode<T, Reduced>|undefined;
    right: AATreeNode<T, Reduced>|undefined;
    parent: AATreeNode<T, Reduced>|undefined;

    level: number;

    // Reduced value, including children
    reducedRecursive: Reduced|undefined;
}

interface AACompareNode<T, Reduced> {
    value: T;
    // Not just the left children, but the reduction of all left values in the tree, going up the whole tree.
    beforeSum: Reduced;
}

type ParentForRef<T, Reduced> = Pick<AATreeNode<T, Reduced>, "left"|"right">|AATreeNode<T, Reduced>;

export class AATree<T, Reduced> {
    nodeRoot: AATreeNode<T, Reduced>|undefined;

    // TODO: We don't respect undefined Reduced values fine, and can't distinguish them between no Reduced value,
    //  and so will default them to reduceDefault.
    constructor(
        private compare: (lhs: AACompareNode<T, Reduced>, rhs: AACompareNode<T, Reduced>) => number,
        private reduceBase: (value: T) => Reduced,
        private reduce: (lhs: Reduced, rhs: Reduced) => Reduced,
        private reduceDefault: Reduced,
    ) { }

    public Add(value: T, beforeSum: Reduced = this.reduceDefault): AATreeNode<T, Reduced> {
        let reduced = this.reduceBase(value);
        let valueNode: AATreeNode<T, Reduced> = {
            left: undefined,
            right: undefined,
            level: 0,
            value: value,
            reduced: reduced,
            reducedRecursive: reduced,
            parent: undefined,
        };
        this.nodeRoot = this.insert(valueNode, beforeSum, this.nodeRoot, undefined);
        return valueNode;
    }
    public Remove(value: T, beforeSum: Reduced) {
        let root: ParentForRef<T, Reduced> = {
            left: undefined,
            right: undefined,
        };
        this.nodeRoot = this.remove({ value, beforeSum: beforeSum }, this.nodeRoot, undefined);
    }

    public GetLeftSum(node: AATreeNode<T, Reduced>): Reduced|undefined {
        let curSum: Reduced|undefined = node.left?.reducedRecursive;
        while(true) {
            let parent = node.parent;
            if(!parent) break;
            // If we are after our parent, then we should include our parent, and their left child
            if(parent.right === node) {
                curSum = this.reduceHelper(curSum, parent.left?.reducedRecursive);
                curSum = this.reduceHelper(curSum, parent.reduced);
            }
            node = parent;
        }

        return curSum;
    }

    public Find(value: T, beforeSum: Reduced = this.reduceDefault) {
        return this.find({value, beforeSum}, this.nodeRoot, undefined);
    }

    public GetRootSum() {
        return this.reduceHelper(this.nodeRoot?.reducedRecursive, undefined);
    }


    private reduceHelper(lhs: Reduced|undefined, rhs: Reduced|undefined): Reduced {
        if(lhs === undefined) {
            if(rhs === undefined) {
                return this.reduceDefault;
            }
            return rhs;
        }
        if(rhs === undefined) return lhs;
        return this.reduce(lhs, rhs);
    }

    private childrenUpdated(parent: AATreeNode<T, Reduced>) {
        if(parent.left) {
            parent.left.parent = parent;
        }
        if(parent.right) {
            parent.right.parent = parent;
        }
        // Clear the parent. If the children our updated our parent.parent must have childrenUpdated
        //  on it anyway, so this will be fine. Without this root parents won't be cleared properly,
        //  leading to loops when following the .parent list.
        parent.parent = undefined;

        let reduced: Reduced = parent.reduced;
        if(parent.left) {
            reduced = this.reduceHelper(reduced, parent.left.reducedRecursive);
        }
        if(parent.right) {
            reduced = this.reduceHelper(reduced, parent.right.reducedRecursive);
        }
        parent.reducedRecursive = reduced;
    }

    // Most of this is just the AA tree implementation straight off wikipedia
    private skew(node: AATreeNode<T, Reduced>): AATreeNode<T, Reduced> {
        if(!node.left) {
            return node;
        }
        if(node.level === node.left.level) {
            // Don't stay on the same level and go to the left, instead, skew to the right.
            let left = node.left;
            node.left = left.right;
            left.right = node;

            this.childrenUpdated(node);
            this.childrenUpdated(left);

            return left;
        }
        return node;
    }

    private split(node: AATreeNode<T, Reduced>): AATreeNode<T, Reduced> {
        if(!node.right || !node.right.right) {
            return node;
        }
        if(node.level === node.right.right.level) {
            // Our two right values don't descend, so we should rearrange the tree downwards
            let right = node.right;
            node.right = right.left;
            right.left = node;
            right.level++;

            this.childrenUpdated(node);
            this.childrenUpdated(right);

            return right;
        }
        return node;
    }

    private find(
        value: AACompareNode<T, Reduced>,
        root: AATreeNode<T, Reduced>|undefined,
        leftParentSum: Reduced|undefined
    ): AATreeNode<T, Reduced>|undefined {
        if(!root) return undefined;
        let leftSum = this.reduceHelper(leftParentSum, root.left?.reducedRecursive);

        let diff = this.compare(value, { value: root.value, beforeSum: leftSum });
        if(diff < 0) {
            return this.find(value, root.left, leftParentSum);
        }

        let sumAtEnd = this.reduceHelper(leftSum, root.reduced);

        // If it is >= our start, but < our end... then we are the node they are searching for.
        let endDiff = this.compare(value, { value: root.value, beforeSum: sumAtEnd });
        if(endDiff < 0) {
            return root;
        }

        return this.find(value, root.right, sumAtEnd);
    }

    private insert(
        valueNode: AATreeNode<T, Reduced>,
        beforeSum: Reduced,
        root: AATreeNode<T, Reduced>|undefined,
        leftParentSum: Reduced|undefined
    ): AATreeNode<T, Reduced> {
        if(!root) {
            return valueNode;
        }

        // Calculate our left
        let leftSum = this.reduceHelper(leftParentSum, root.left?.reducedRecursive);

        let diff = this.compare({ value: valueNode.value, beforeSum: beforeSum }, { value: root.value, beforeSum: leftSum });
        if(diff <= 0) {
            // As we are not left of our left node, it's left parent is just our left parent.
            root.left = this.insert(valueNode, beforeSum, root.left, leftParentSum);
        } else {
            // We are to the left of our right, so it should include our parent left, our left, and our value.
            let sumForRight = this.reduceHelper(leftSum, root.reduced);
            root.right = this.insert(valueNode, beforeSum, root.right, sumForRight);
        }

        root = this.skew(root);
        root = this.split(root);

        this.childrenUpdated(root);
        return root;
    }

    private remove(
        value: AACompareNode<T, Reduced>,
        root: AATreeNode<T, Reduced>|undefined,
        leftParentSum: Reduced|undefined
    ): AATreeNode<T, Reduced>|undefined {

        if(!root) return undefined;

        let leftSum = this.reduceHelper(leftParentSum, root.left?.reducedRecursive); 

        let diff = this.compare(value, { value: root.value, beforeSum: leftSum });
        if(diff < 0) {
            root.left = this.remove(value, root.left, leftParentSum);
        } else {
            let sumAtEnd = this.reduceHelper(leftSum, root.reduced);
            
            let endDiff = this.compare(value, { value: root.value, beforeSum: sumAtEnd });
            if(endDiff < 0) {
                // Delete the current node
                if(!root.left && !root.right) {
                    return undefined;
                } else if(!root.left) {
                    if(!root.right) throw new Error(`Internal error, impossible, we checked for !left && !right`);
                    // We want to bring up the smallest node after, and make our value equal to it.
                    let successor = root.right;
                    while(successor.left) {
                        successor = successor.left;
                    }
                    root.value = successor.value;
                    // As successor is the first one after us, beforeSum can be sumAtEnd
                    root.right = this.remove({ value: successor.value, beforeSum: sumAtEnd }, root.right, sumAtEnd);
                } else {
                    // Largest node before us

                    if(g.breakOnThisMutateIndex && g.mutateIndex === g.breakOnThisMutateIndex) {
                        debugger;
                    }

                    let successorSum = this.reduceHelper(leftParentSum, undefined);
                    let successor = root.left;
                    successorSum = this.reduceHelper(successorSum, successor.left?.reducedRecursive);
                    while(successor.right) {
                        successorSum = this.reduceHelper(successorSum, successor.reduced);
                        successor = successor.right;
                        successorSum = this.reduceHelper(successorSum, successor.left?.reducedRecursive);
                    }

                    root.value = successor.value;
                    root.left = this.remove({ value: successor.value, beforeSum: successorSum }, root.left, leftParentSum);
                }
            } else {
                root.right = this.remove(value, root.right, sumAtEnd);
            }
        }
    

        {
            let new_level = Math.min(root.left?.level || 0, root.right?.level || 0);
            if(new_level < root.level) {
                root.level = new_level;
                if(root.right && new_level < root.right.level) {
                    root.right.level = new_level;
                }
            }
        }

        root = this.skew(root);
        if(root.right) {
            root.right = this.skew(root.right);
        }
        if(root.right && root.right.right) {
            root.right.right = this.skew(root.right.right);
            this.childrenUpdated(root.right);
        }

        root = this.split(root);
        if(root.right) {
            root.right = this.split(root.right);
        }

        this.childrenUpdated(root);

        return root;
    }
}