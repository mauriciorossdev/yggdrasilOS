import { describe, expect, it } from "vitest";
import { checkComponents } from "./react.js";

describe("checkComponents", () => {
  it("accepts separate component files used from App", () => {
    expect(
      checkComponents({
        "src/Counter.jsx": "export default function Counter() { return null }",
        "src/TodoList.jsx": "export const TodoList = () => null;",
        "src/App.jsx": "import Counter from './Counter'; import { TodoList } from './TodoList'; export default () => <><Counter /><TodoList /></>",
      }),
    ).toBeNull();
  });

  it("accepts components defined inline in App, which the prompt does not forbid", () => {
    expect(
      checkComponents({
        "src/App.jsx": "function Counter() { return null }\nfunction TodoList() { return null }\nexport default function App() { return <><Counter /><TodoList /></>; }",
      }),
    ).toBeNull();
  });

  it("rejects a missing component, an App that ignores one, and a missing App", () => {
    expect(checkComponents({ "src/App.jsx": "function Counter() {}\nexport default function App() { return <Counter /> }" })).toMatch(/no definition of: TodoList/);
    expect(
      checkComponents({
        "src/Counter.jsx": "export default function Counter() {}",
        "src/TodoList.jsx": "export default function TodoList() {}",
        "src/App.jsx": "import Counter from './Counter'; export default () => <Counter />",
      }),
    ).toMatch(/App does not use: TodoList/);
    expect(checkComponents({ "src/Counter.jsx": "function Counter() {}", "src/TodoList.jsx": "function TodoList() {}" })).toMatch(/no App/);
  });

  it("does not count a component defined in App as 'used' just because it is declared there", () => {
    expect(checkComponents({ "src/App.jsx": "function Counter() {}\nfunction TodoList() {}\nexport default function App() { return null }" })).toMatch(/App does not use: Counter, TodoList/);
  });
});
