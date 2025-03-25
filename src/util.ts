export function checkInput(i: string): boolean {
  if (
    i.toLowerCase().includes("@channel") ||
    i.toLowerCase().includes("<!channel>") ||
    i.toLowerCase().includes("@everyone") ||
    i.toLowerCase().includes("<!everyone>") ||
    i.toLowerCase().includes("@here") ||
    i.toLowerCase().includes("<!here>") ||
    i.toLowerCase().includes("subteam")  ||
    i.toLowerCase().includes("<!subteam>") ||
    i.toLowerCase().includes("<@") 
  ) {
    return false;
  }

  return true;
}
