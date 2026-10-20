// The reactions a person may put on a message (M29.4): the canvas's six, in its order, with the words each button is
// named by. The page draws them and the chat refuses any other; kept apart from the store so the page can import it.
export const REACTIONS: ReadonlyArray<readonly [string, string]> = [
  ["👍", "thumbs up"],
  ["❤️", "heart"],
  ["😂", "laughing face"],
  ["😮", "surprised face"],
  ["😢", "crying face"],
  ["🙏", "folded hands"],
];
