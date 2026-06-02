import {
  type EventConstructor,
  Node,
  Wildcards,
  stateName,
  eventName,
  isNamer,
} from "./node.js";

/**
 * Edge represents a directed state transition in the graph.
 */
export interface Edge<S> {
  /** Source state (null indicates a wildcard transition) */
  from: S | null;
  /** Event constructor that triggers this transition */
  event: EventConstructor;
  /** Destination state */
  to: S;
}

/**
 * Graph represents a directed state transition graph with typed nodes and transitions.
 */
export class Graph<S> {
  /** The starting Node of the Graph */
  readonly initialNode: Node<S>;
  /** Global transitions from any Node */
  readonly wildcards: Wildcards<S>;

  constructor(initialNode: Node<S>, wildcards: Wildcards<S>) {
    this.initialNode = initialNode;
    this.wildcards = wildcards;
  }

  private getEdges(): Edge<S>[] {
    const ret: Edge<S>[] = [];

    // Process wildcard transitions
    for (let i = 0; i < this.wildcards.events.length; i++) {
      ret.push({
        from: null,
        event: this.wildcards.events[i],
        to: this.wildcards.nextNodes[i].state,
      });
    }

    // BFS to collect all edges
    const visited = new Set<Node<S>>();
    const queue: Node<S>[] = [this.initialNode];
    queue.push(...this.wildcards.nextNodes);

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);
      queue.push(...node.nextNodes);
      for (let i = 0; i < node.events.length; i++) {
        ret.push({
          from: node.state,
          event: node.events[i],
          to: node.nextNodes[i].state,
        });
      }
    }

    return ret;
  }

  /**
   * dump converts the graph to a Mermaid state diagram string representation.
   */
  dump(): string {
    const init = this.initialNode.state;
    const edges = this.getEdges();

    const headers = ["stateDiagram-v2"];
    headers.push(`[*] --> ${stateName(init)}`);

    const lines: string[] = [];
    for (const edge of edges) {
      const from = edge.from == null ? "*" : stateName(edge.from);
      const to = stateName(edge.to);
      lines.push(`${from} --> ${to}: ${eventName(edge.event)}`);
    }
    lines.sort();

    return [...headers, ...lines].join("\n  ");
  }
}

/**
 * dump converts a graph to a Mermaid state diagram string representation.
 */
export function dump<S>(g: Graph<S>): string {
  return g.dump();
}

/**
 * newGraph creates a new Graph with the given initial state and edges.
 * Throws if validation fails (duplicate transitions, unreachable nodes, etc.).
 */
export function newGraph<S>(init: S, ...edges: Edge<S>[]): Graph<S> {
  const registry = new NodeRegistry<S>();
  const initialNode = registry.getOrCreate(init);
  registry.handle(edges);

  // Reachability analysis
  const visited = new Set<Node<S>>();
  const queue: Node<S>[] = [initialNode];

  // Mark wildcard destinations as reachable
  for (const node of registry.wilds.values()) {
    if (visited.has(node)) {
      continue;
    }
    visited.add(node);
    queue.push(...node.nextNodes);
  }

  // BFS traversal
  while (queue.length > 0) {
    const head = queue.shift()!;
    if (visited.has(head)) {
      continue;
    }
    visited.add(head);
    queue.push(...head.nextNodes);
  }

  // Check for unreachable nodes
  const unreachableNodes: string[] = [];
  for (const [, node] of registry.names) {
    if (!visited.has(node)) {
      unreachableNodes.push(stateName(node.state));
    }
  }
  for (const [, node] of registry.constructors) {
    if (!visited.has(node)) {
      unreachableNodes.push(stateName(node.state));
    }
  }
  if (unreachableNodes.length > 0) {
    unreachableNodes.sort();
    throw new Error(`unreachable nodes: [${unreachableNodes.join(" ")}]`);
  }

  // Build result
  const wildcards = new Wildcards<S>();
  for (const [event, node] of registry.wilds) {
    wildcards.events.push(event);
    wildcards.nextNodes.push(node);
  }

  return new Graph<S>(initialNode, wildcards);
}

class NodeRegistry<S> {
  /** @internal */ readonly names = new Map<string, Node<S>>();
  /** @internal */ readonly constructors = new Map<new (...args: any[]) => object, Node<S>>();
  /** @internal */ readonly wilds = new Map<EventConstructor, Node<S>>();

  getOrCreate(s: S): Node<S> {
    const node = this.getOrCreateInternal(s);
    if (node.state !== s) {
      throw new Error(
        `node ${stateName(s)} already exists as ${stateName(node.state)}`,
      );
    }
    return node;
  }

  private getOrCreateInternal(s: S): Node<S> {
    if (isNamer(s)) {
      const n = s.name();
      const existing = this.names.get(n);
      if (existing != null) {
        return existing;
      }
      const node = new Node<S>(s);
      this.names.set(n, node);
      return node;
    }

    const ctor = (s as object).constructor as new (...args: any[]) => object;
    const existing = this.constructors.get(ctor);
    if (existing != null) {
      return existing;
    }
    const node = new Node<S>(s);
    this.constructors.set(ctor, node);
    return node;
  }

  handle(edges: { from: S | null; event: EventConstructor; to: S }[]): void {
    const wilds: typeof edges = [];
    const regulars: typeof edges = [];

    for (const edge of edges) {
      if (edge.to == null) {
        throw new Error(
          `invalid edge: node is null (${stateName(edge.from)} -> ${stateName(edge.to)}: ${eventName(edge.event)})`,
        );
      }
      if (edge.from == null) {
        wilds.push(edge);
      } else {
        regulars.push(edge);
      }
    }

    for (const edge of wilds) {
      this.handleWild(edge.event, edge.to);
    }
    for (const edge of regulars) {
      this.handleEdge(edge.event, edge.from!, edge.to);
    }
  }

  private handleWild(event: EventConstructor, to: S): void {
    const node = this.getOrCreate(to);
    if (this.wilds.has(event)) {
      throw new Error(
        `wildcard transition already exists: ${eventName(event)}`,
      );
    }
    this.wilds.set(event, node);
  }

  private handleEdge(event: EventConstructor, from: S, to: S): void {
    const node = this.getOrCreate(from);
    const toNode = this.getOrCreate(to);

    for (const e of node.events) {
      if (e === event) {
        throw new Error(
          `transition ${eventName(event)} already exists for node ${stateName(from)}`,
        );
      }
    }
    if (this.wilds.has(event)) {
      throw new Error(
        `wildcard transition already exists: ${eventName(event)}`,
      );
    }

    node.events.push(event);
    node.nextNodes.push(toNode);
  }
}
