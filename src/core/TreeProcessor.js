getJasmineRequireObj().TreeProcessor = function(j$) {
  const defaultMin = Infinity;
  const defaultMax = 1 - Infinity;

  class TreeProcessor {
    #tree;
    #runQueue;
    #runnableIds;
    #nodeStart;
    #nodeComplete;
    #failSpecWithNoExpectations;
    #detectLateRejectionHandling;
    #globalErrors;
    #orderChildren;
    #excludeNode;
    #stats;
    #processed;

    constructor(attrs) {
      this.#tree = attrs.tree;
      this.#runnableIds = attrs.runnableIds;
      this.#runQueue = attrs.runQueue;
      this.#nodeStart = attrs.nodeStart || function() {};
      this.#nodeComplete = attrs.nodeComplete || function() {};
      this.#failSpecWithNoExpectations = !!attrs.failSpecWithNoExpectations;
      this.#detectLateRejectionHandling = !!attrs.detectLateRejectionHandling;
      this.#globalErrors = attrs.globalErrors;

      this.#orderChildren =
        attrs.orderChildren ||
        function(node) {
          return node.children;
        };
      this.#excludeNode =
        attrs.excludeNode ||
        function(node) {
          return false;
        };
      this.#stats = { valid: true };
      this.#processed = false;
    }

    processTree() {
      this.#processNode(this.#tree, true);
      this.#processed = true;
      return this.#stats;
    }

    async execute() {
      if (!this.#processed) {
        this.processTree();
      }

      if (!this.#stats.valid) {
        throw new Error('invalid order');
      }

      const childFns = this.#wrapChildren(this.#tree, 0);

      await new Promise(resolve => {
        this.#runQueue({
          queueableFns: childFns,
          userContext: this.#tree.sharedUserContext(),
          onException: function() {
            this.#tree.handleException.apply(this.#tree, arguments);
          }.bind(this),
          onComplete: resolve,
          onMultipleDone: this.#tree.onMultipleDone
            ? this.#tree.onMultipleDone.bind(this.#tree)
            : null
        });
      });
    }

    #runnableIndex(id) {
      for (let i = 0; i < this.#runnableIds.length; i++) {
        if (this.#runnableIds[i] === id) {
          return i;
        }
      }
    }

    #processNode(node, parentExcluded) {
      const executableIndex = this.#runnableIndex(node.id);

      if (executableIndex !== undefined) {
        parentExcluded = false;
      }

      if (!node.children) {
        const excluded = parentExcluded || this.#excludeNode(node);
        this.#stats[node.id] = {
          excluded: excluded,
          willExecute: !excluded && !node.markedPending,
          segments: [
            {
              index: 0,
              owner: node,
              nodes: [node],
              min: startingMin(executableIndex),
              max: startingMax(executableIndex)
            }
          ]
        };
      } else {
        let hasExecutableChild = false;

        const orderedChildren = this.#orderChildren(node);

        for (let i = 0; i < orderedChildren.length; i++) {
          const child = orderedChildren[i];

          this.#processNode(child, parentExcluded);

          if (!this.#stats.valid) {
            return;
          }

          const childStats = this.#stats[child.id];

          hasExecutableChild = hasExecutableChild || childStats.willExecute;
        }

        this.#stats[node.id] = {
          excluded: parentExcluded,
          willExecute: hasExecutableChild
        };

        segmentChildren(node, orderedChildren, this.#stats, executableIndex);

        if (this.#stats[node.id].segments.length > 1) {
          if (node.canBeReentered()) {
            j$.getEnv().deprecated(
              'The specified spec/suite order splits up a suite, running unrelated specs in the middle of it. This will become an error in a future release.'
            );
          } else {
            this.#stats = { valid: false };
            throw new Error(
              'Invalid order: would cause a beforeAll or afterAll to be run multiple times'
            );
          }
        }
      }
    }

    #wrapChildren(node, segmentNumber) {
      const result = [],
        segmentChildren = this.#stats[node.id].segments[segmentNumber].nodes;

      for (let i = 0; i < segmentChildren.length; i++) {
        result.push(
          this.#executeNode(segmentChildren[i].owner, segmentChildren[i].index)
        );
      }

      if (!this.#stats[node.id].willExecute) {
        return result;
      }

      return node.beforeAllFns.concat(result).concat(node.afterAllFns);
    }

    #executeNode(node, segmentNumber) {
      if (node.children) {
        return {
          fn: function(done) {
            const onStart = {
              fn: next => {
                this.#nodeStart(node, next);
              }
            };

            this.#runQueue({
              onComplete: function() {
                const args = Array.prototype.slice.call(arguments, [0]);
                node.cleanupBeforeAfter();
                this.#nodeComplete(node, node.getResult(), () => {
                  done.apply(undefined, args);
                });
              }.bind(this),
              queueableFns: [onStart].concat(
                this.#wrapChildren(node, segmentNumber)
              ),
              userContext: node.sharedUserContext(),
              onException: function() {
                node.handleException.apply(node, arguments);
              },
              onMultipleDone: node.onMultipleDone
                ? node.onMultipleDone.bind(node)
                : null
            });
          }.bind(this)
        };
      } else {
        return {
          fn: done => {
            node.execute(
              this.#runQueue,
              this.#globalErrors,
              done,
              this.#stats[node.id].excluded,
              this.#failSpecWithNoExpectations,
              this.#detectLateRejectionHandling
            );
          }
        };
      }
    }
  }

  function segmentChildren(node, orderedChildren, stats, executableIndex) {
    let currentSegment = {
        index: 0,
        owner: node,
        nodes: [],
        min: startingMin(executableIndex),
        max: startingMax(executableIndex)
      },
      result = [currentSegment],
      lastMax = defaultMax,
      orderedChildSegments = orderChildSegments(orderedChildren, stats);

    function isSegmentBoundary(minIndex) {
      return (
        lastMax !== defaultMax &&
        minIndex !== defaultMin &&
        lastMax < minIndex - 1
      );
    }

    for (let i = 0; i < orderedChildSegments.length; i++) {
      const childSegment = orderedChildSegments[i],
        maxIndex = childSegment.max,
        minIndex = childSegment.min;

      if (isSegmentBoundary(minIndex)) {
        currentSegment = {
          index: result.length,
          owner: node,
          nodes: [],
          min: defaultMin,
          max: defaultMax
        };
        result.push(currentSegment);
      }

      currentSegment.nodes.push(childSegment);
      currentSegment.min = Math.min(currentSegment.min, minIndex);
      currentSegment.max = Math.max(currentSegment.max, maxIndex);
      lastMax = maxIndex;
    }

    stats[node.id].segments = result;
  }

  function orderChildSegments(children, stats) {
    const specifiedOrder = [],
      unspecifiedOrder = [];

    for (let i = 0; i < children.length; i++) {
      const child = children[i],
        segments = stats[child.id].segments;

      for (let j = 0; j < segments.length; j++) {
        const seg = segments[j];

        if (seg.min === defaultMin) {
          unspecifiedOrder.push(seg);
        } else {
          specifiedOrder.push(seg);
        }
      }
    }

    specifiedOrder.sort(function(a, b) {
      return a.min - b.min;
    });

    return specifiedOrder.concat(unspecifiedOrder);
  }

  function startingMin(executableIndex) {
    return executableIndex === undefined ? defaultMin : executableIndex;
  }

  function startingMax(executableIndex) {
    return executableIndex === undefined ? defaultMax : executableIndex;
  }

  return TreeProcessor;
};
