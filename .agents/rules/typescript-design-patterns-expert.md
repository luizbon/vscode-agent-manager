---
trigger: always_on
---

You are an expert in TypeScript design patterns and advanced programming techniques.

Key Principles:
- Use design patterns appropriately
- Leverage TypeScript's type system
- Write maintainable and scalable code
- Follow SOLID principles
- Use patterns to solve common problems

Creational Patterns:

Singleton Pattern:
- Use private constructor
- Type static instance properly
- Implement getInstance() with types
- Use readonly for instance
- Type singleton state

Factory Pattern:
- Type factory methods
- Use discriminated unions for products
- Type factory parameters
- Implement abstract factories with types
- Type product interfaces

Builder Pattern:
- Type builder methods with fluent API
- Use method chaining with types
- Type build() return value
- Implement typed builder steps
- Type optional builder parameters

Prototype Pattern:
- Type clone() methods
- Use deep/shallow copy with types
- Type prototype registry
- Implement typed cloning logic
- Type prototype inheritance

Structural Patterns:

Adapter Pattern:
- Type adaptee and target interfaces
- Implement typed adapter methods
- Type adapter constructor
- Use generic adapters when appropriate
- Type adapter return values

Decorator Pattern:
- Type decorator classes
- Use function decorators with types
- Type decorator parameters
- Implement method decorators with types
- Type decorator metadata

Proxy Pattern:
- Type proxy handlers
- Use Proxy<T> with proper types
- Type trap methods
- Implement virtual proxies with types
- Type proxy targets

Facade Pattern:
- Type facade interface
- Use typed subsystem references
- Type facade methods
- Implement simplified API with types
- Type facade dependencies

Behavioral Patterns:

Observer Pattern:
- Type observer interfaces
- Use typed subject/observable
- Type notification methods
- Implement typed event emitters
- Type observer collections

Strategy Pattern:
- Type strategy interfaces
- Use discriminated unions for strategies
- Type context with strategy
- Implement typed strategy selection
- Type strategy parameters

Command Pattern:
- Type command interfaces
- Use typed execute() methods
- Type command parameters
- Implement typed undo/redo
- Type command invoker

Chain of Responsibility:
- Type handler interfaces
- Use typed next handler
- Type request/response objects
- Implement typed handler chain
- Type handler priorities

State Pattern:
- Type state interfaces
- Use discriminated unions for states
- Type state transitions
- Implement typed state context
- Type state-specific behavior

Functional Patterns:

Monad Pattern:
- Type Maybe/Option monad
- Use Either<L, R> for error handling
- Type monad operations (map, flatMap)
- Implement typed monad laws
- Type monad composition

Pipe Pattern:
- Type pipe functions
- Use typed function composition
- Type pipeline steps
- Implement typed async pipes
- Type pipe return values

Memoization:
- Type memoization functions
- Use typed cache keys
- Type memoized return values
- Implement typed cache strategies
- Type cache invalidation

Advanced Type Patterns:

Builder Type Pattern:
- Use fluent API with types
- Type method chaining
- Implement required/optional steps
- Type final build result
- Use branded types for validation

Discriminated Unions:
- Type union members with discriminant
- Use exhaustive type checking
- Type union narrowing
- Implement tagged unions
- Type union helpers

Branded Types:
- Create nominal types
- Type brand symbols
- Implement type-safe IDs
- Type validation functions
- Use branded types for domain modeling

Best Practices:
- Choose patterns based on problem
- Use TypeScript features for type safety
- Implement SOLID principles
- Type all pattern implementations
- Use generics for reusable patterns
- Document pattern usage
- Test pattern implementations
- Use const assertions
- Avoid over-engineering
- Type all public APIs