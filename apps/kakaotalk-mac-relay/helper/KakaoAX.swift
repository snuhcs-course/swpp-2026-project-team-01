// kakao-ax: the Mac relay's accessibility helper (host-kakaotalk-mac-relay
// designs 5, 7, 8 and 9). Build on the Mac with
//   xcrun swiftc -O -o kakao-ax helper/KakaoAX.swift
// Commands, each printing one JSON object:
//   supervise <node> <args...>  run the daemon as a child and restart it after
//                               a crash; macOS attributes the child (and the
//                               kakaocli it runs) to this binary, which holds
//                               the Accessibility grant
//   probe                       {trusted, locked, kakaoRunning, kakaoVersion}
//   rows                        {names: [...]}: the chat list's name labels
//   leave --name <name>         {stage, detail}: leave the group whose chat-list
//                               label is exactly <name>
// The chat list's shape is kakaocli's (AXWindow "Main Window" > AXScrollArea >
// AXTable > AXRow > AXCell > AXStaticText _NS:18 or _NS:40). The chat window's
// menu and its leave item are looked up by title and fail closed: nothing is
// pressed unless exactly one candidate is found.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let bundleId = "com.kakao.KakaoTalkMac"
let nameLabelIds: Set<String> = ["_NS:18", "_NS:40"]
let menuTitles = ["메뉴", "Menu", "더보기", "More"]
let leaveTitles = ["나가기", "채팅방 나가기", "Leave", "Leave Chat", "Leave chatroom"]

func emit(_ object: [String: Any], code: Int32 = 0) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(code)
}

func attr(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func str(_ element: AXUIElement, _ name: String) -> String { (attr(element, name) as? String) ?? "" }
func role(_ element: AXUIElement) -> String { str(element, kAXRoleAttribute) }
func ident(_ element: AXUIElement) -> String { str(element, "AXIdentifier") }
func children(_ element: AXUIElement) -> [AXUIElement] { (attr(element, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func press(_ element: AXUIElement) -> Bool { AXUIElementPerformAction(element, kAXPressAction as CFString) == .success }
func label(_ element: AXUIElement) -> String {
  [str(element, kAXTitleAttribute), str(element, kAXDescriptionAttribute), str(element, kAXValueAttribute)].first { !$0.isEmpty } ?? ""
}

func screenLocked() -> Bool {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
  return (session["CGSSessionScreenIsLocked"] as? Bool) ?? ((session["CGSSessionScreenIsLocked"] as? Int) == 1)
}

func kakaoApp() -> NSRunningApplication? { NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first }

func kakaoVersion() -> String? {
  Bundle(url: URL(fileURLWithPath: "/Applications/KakaoTalk.app"))?.infoDictionary?["CFBundleShortVersionString"] as? String
}

func windows(_ app: AXUIElement) -> [AXUIElement] {
  ((attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []).filter { role($0) == "AXWindow" }
}

// Finds elements depth first, skipping menus.
func findAll(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 14, _ match: (AXUIElement) -> Bool) -> [AXUIElement] {
  if depth > maxDepth { return [] }
  var found = match(element) ? [element] : []
  for child in children(element) where !role(child).hasPrefix("AXMenu") || depth == 0 {
    found += findAll(child, depth: depth + 1, maxDepth: maxDepth, match)
  }
  return found
}

// The main window, opened from the status menu when KakaoTalk keeps it hidden.
func mainWindow(_ app: AXUIElement, running: NSRunningApplication) -> AXUIElement? {
  if let window = windows(app).first(where: { ident($0) == "Main Window" }) { return window }
  for item in findAll(app, maxDepth: 6, { ident($0) == "showFirstWindow:" }) { _ = press(item) }
  running.activate()
  for _ in 0..<20 {
    Thread.sleep(forTimeInterval: 0.25)
    if let window = windows(app).first(where: { ident($0) == "Main Window" }) { return window }
  }
  return nil
}

func chatTable(_ window: AXUIElement) -> AXUIElement? {
  // The chats tab is an AXCheckBox in kakaocli's notes and an AXButton in KakaoTalk 26.
  if let tab = findAll(window, maxDepth: 6, { ident($0) == "chatrooms" && ["AXCheckBox", "AXButton"].contains(role($0)) }).first {
    _ = press(tab)
    Thread.sleep(forTimeInterval: 0.3)
  }
  for area in children(window) where role(area) == "AXScrollArea" {
    if let table = children(area).first(where: { role($0) == "AXTable" }) { return table }
  }
  return nil
}

func rowNames(_ table: AXUIElement) -> [(row: AXUIElement, name: String)] {
  var rows: [(AXUIElement, String)] = []
  for row in children(table) where role(row) == "AXRow" {
    for cell in children(row) where role(cell) == "AXCell" {
      if let text = children(cell).first(where: { role($0) == "AXStaticText" && nameLabelIds.contains(ident($0)) }) {
        rows.append((row, str(text, kAXValueAttribute)))
        break
      }
    }
  }
  return rows
}

func chatList() -> (app: AXUIElement, table: AXUIElement, rows: [(row: AXUIElement, name: String)])? {
  guard !screenLocked(), let running = kakaoApp() else { return nil }
  let app = AXUIElementCreateApplication(running.processIdentifier)
  guard let window = mainWindow(app, running: running), let table = chatTable(window) else { return nil }
  return (app, table, rowNames(table))
}

func probe() -> Never {
  emit(["kakaoRunning": kakaoApp() != nil, "kakaoVersion": kakaoVersion() ?? "", "locked": screenLocked(), "trusted": AXIsProcessTrusted()])
}

func rows() -> Never {
  guard let list = chatList() else { emit(["available": false, "names": NSNull()], code: 2) }
  emit(["available": true, "names": list.rows.map(\.name)])
}

func pressReturn() {
  for down in [true, false] { CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: down)?.post(tap: .cghidEventTap) }
}

func waitFor<T>(seconds: Double, _ body: () -> T?) -> T? {
  let deadline = Date().addingTimeInterval(seconds)
  while Date() < deadline {
    if let value = body() { return value }
    Thread.sleep(forTimeInterval: 0.25)
  }
  return nil
}

func leave(name: String) -> Never {
  guard let list = chatList() else { emit(["detail": "chat list unavailable", "stage": "no_menu"]) }
  let matches = list.rows.filter { $0.name.localizedCaseInsensitiveContains(name) }
  guard matches.count == 1, matches[0].name == name else { emit(["detail": "\(matches.count) rows match", "stage": "not_found"]) }

  // Every other window must close first, so the one that opens is the room's.
  for window in windows(list.app) where ident(window) != "Main Window" {
    if let close = attr(window, kAXCloseButtonAttribute) { _ = press(close as! AXUIElement) }
  }
  guard waitFor(seconds: 3, { windows(list.app).allSatisfy { ident($0) == "Main Window" } ? true : nil }) != nil else {
    emit(["detail": "another window stayed open", "stage": "no_menu"])
  }
  // Select the row and read the selection back before opening it.
  let row = matches[0].row
  guard AXUIElementSetAttributeValue(list.table, kAXSelectedRowsAttribute as CFString, [row] as CFTypeRef) == .success,
        let selected = attr(list.table, kAXSelectedRowsAttribute) as? [AXUIElement], selected.count == 1, selected[0] == row else {
    emit(["detail": "row not selected", "stage": "no_menu"])
  }
  Thread.sleep(forTimeInterval: 0.2)
  pressReturn()
  let opened: [AXUIElement]? = waitFor(seconds: 5) {
    let chats = windows(list.app).filter { ident($0) != "Main Window" }
    return chats.isEmpty ? nil : chats
  }
  guard let opened, opened.count == 1 else { emit(["detail": "no single chat window opened", "stage": "no_menu"]) }
  let chat = opened[0]
  // The opened window must show the room's name as its title; anything else fails closed.
  guard str(chat, kAXTitleAttribute) == name else {
    if let close = attr(chat, kAXCloseButtonAttribute) { _ = press(close as! AXUIElement) }
    emit(["detail": "opened window does not show the name", "stage": "not_found"])
  }

  let menus = findAll(chat) { ["AXButton", "AXMenuButton", "AXPopUpButton"].contains(role($0)) && menuTitles.contains(label($0)) }
  guard menus.count == 1 else { emit(["detail": "\(menus.count) menu buttons", "stage": "no_menu"]) }
  _ = press(menus[0])
  let leaveItem: AXUIElement? = waitFor(seconds: 3) {
    let items = findAll(list.app, maxDepth: 18) { ["AXMenuItem", "AXButton"].contains(role($0)) && leaveTitles.contains(label($0)) }
    return items.count == 1 ? items[0] : nil
  }
  guard let leaveItem else { emit(["detail": "no single leave item", "stage": "no_item"]) }
  _ = press(leaveItem)

  // The confirmation alert: a sheet or dialog with a leave button.
  let confirm: AXUIElement? = waitFor(seconds: 5) {
    let buttons = findAll(list.app, maxDepth: 18) { role($0) == "AXButton" && leaveTitles.contains(label($0)) && $0 != leaveItem }
    return buttons.count == 1 ? buttons[0] : nil
  }
  guard let confirm else { emit(["detail": "no confirmation", "stage": "no_confirm"]) }
  _ = press(confirm)
  emit(["detail": "pressed", "stage": "pressed"])
}

// Runs the daemon as a child and restarts it, waiting 1 s, then doubling up to 60 s,
// after each exit; a run that lasted ten minutes resets the wait.
func supervise(_ command: [String]) -> Never {
  guard let executable = command.first else { emit(["error": "supervise needs a command"], code: 64) }
  var child: Process?
  for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
      child?.terminate()
      exit(0)
    }
    source.resume()
    _ = Unmanaged.passRetained(source)
  }
  DispatchQueue.global().async {
    var wait = 1.0
    while true {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: executable)
      process.arguments = Array(command.dropFirst())
      child = process
      let started = Date()
      do {
        try process.run()
        process.waitUntilExit()
      } catch {
        FileHandle.standardError.write(Data("kakao-ax: could not start \(executable)\n".utf8))
      }
      wait = Date().timeIntervalSince(started) > 600 ? 1 : min(wait * 2, 60)
      Thread.sleep(forTimeInterval: wait)
    }
  }
  dispatchMain()
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "probe": probe()
case "rows": rows()
case "leave":
  guard args.count == 3, args[1] == "--name", !args[2].isEmpty else { emit(["error": "usage: leave --name <name>"], code: 64) }
  leave(name: args[2])
case "supervise": supervise(Array(args.dropFirst()))
default: emit(["error": "usage: kakao-ax probe | rows | leave --name <name> | supervise <command...>"], code: 64)
}
