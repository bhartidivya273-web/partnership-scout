import { describe, expect, it } from "vitest";
import { categoriesFromTopics } from "@/lib/categories";
import { cleanProductText, DEFAULT_PRODUCT_TEXT } from "@/lib/input";

describe("topic fallback table (test spec D1)", () => {
  it.each([
    [["Task Management", "Productivity"], ["project_management"]],
    [["Developer Tools", "Open Source"], ["developer_productivity"]],
    [["Messaging"], ["team_communication"]],
    [["Human Resources", "Hiring"], ["hr_tech"]],
    [["Artificial Intelligence"], []],
    [["Task Management", "Meetings"], ["project_management", "team_communication"]],
    [["task management"], ["project_management"]],
    [[], []],
  ])("%j gives %j", (topics, expected) => {
    expect(categoriesFromTopics(topics)).toEqual(expected);
  });
});

describe("input guard (PRD A7)", () => {
  it("falls back to the default text when empty or not a string", () => {
    expect(cleanProductText("")).toBe(DEFAULT_PRODUCT_TEXT);
    expect(cleanProductText("   ")).toBe(DEFAULT_PRODUCT_TEXT);
    expect(cleanProductText(undefined)).toBe(DEFAULT_PRODUCT_TEXT);
    expect(cleanProductText(42)).toBe(DEFAULT_PRODUCT_TEXT);
  });
  it("strips control characters and tidies spaces", () => {
    expect(cleanProductText("Async\u0000 stand\u001fups   for  teams\n")).toBe("Async stand ups for teams");
  });
  it("limits the length to 300 characters", () => {
    expect(cleanProductText("a".repeat(1000))).toHaveLength(300);
  });
});
