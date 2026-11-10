// offscreen: run and drive a Mac app on a virtual display without touching the user's cursor, keyboard or focus.
// CGVirtualDisplay is private API; these declarations match the ones in Chromium's
// ui/display/mac/test/virtual_display_mac_util.mm. Build with offscreen.sh.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <libproc.h>

@interface CGVirtualDisplayDescriptor : NSObject
@property(retain, nonatomic) dispatch_queue_t queue;
@property(retain, nonatomic) NSString *name;
@property(nonatomic) unsigned int maxPixelsWide;
@property(nonatomic) unsigned int maxPixelsHigh;
@property(nonatomic) CGSize sizeInMillimeters;
@property(nonatomic) unsigned int productID;
@property(nonatomic) unsigned int vendorID;
@property(nonatomic) unsigned int serialNum;
@property(copy, nonatomic) void (^terminationHandler)(id, id);
@end

@interface CGVirtualDisplayMode : NSObject
- (instancetype)initWithWidth:(unsigned int)width height:(unsigned int)height refreshRate:(double)refreshRate;
@end

@interface CGVirtualDisplaySettings : NSObject
@property(nonatomic) unsigned int hiDPI;
@property(retain, nonatomic) NSArray *modes;
@end

@interface CGVirtualDisplay : NSObject
@property(readonly, nonatomic) unsigned int displayID;
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@end

static NSString *const kDisplayName = @"cc-offscreen";
static const unsigned int kSerial = 0x0FF5C2EE;

static void die(NSString *msg) {
  fprintf(stderr, "offscreen: %s\n", msg.UTF8String);
  exit(1);
}

static void out(NSString *msg) { printf("%s\n", msg.UTF8String); fflush(stdout); }

// The virtual display is the one whose serial number we set.
static CGDirectDisplayID findDisplay(void) {
  CGDirectDisplayID ids[32];
  uint32_t n = 0;
  if (CGGetOnlineDisplayList(32, ids, &n) != kCGErrorSuccess) return 0;
  for (uint32_t i = 0; i < n; i++) {
    if (CGDisplaySerialNumber(ids[i]) == kSerial) return ids[i];
  }
  return 0;
}

static NSString *displayPidFile(void) {
  return [NSTemporaryDirectory() stringByAppendingPathComponent:@"cc-offscreen-display.pid"];
}

// Every command that needs the display touches the pidfile; `display` stops
// itself once the pidfile has gone untouched for its idle limit.
static CGDirectDisplayID requireDisplay(void) {
  CGDirectDisplayID d = findDisplay();
  if (!d) die(@"no virtual display; start one with `offscreen display` (keep it running)");
  utimes(displayPidFile().fileSystemRepresentation, NULL);
  return d;
}

// Global top-left coordinates, the space AX positions and CGWindow bounds use.
static CGRect displayBounds(CGDirectDisplayID d) { return CGDisplayBounds(d); }

// Park the virtual display far below-left of every real display so the
// user's cursor only reaches it by deliberately crossing the shared edge corner.
static void parkDisplay(CGDirectDisplayID d) {
  CGDirectDisplayID ids[32];
  uint32_t n = 0;
  CGGetOnlineDisplayList(32, ids, &n);
  CGFloat minX = 0, maxY = 0;
  for (uint32_t i = 0; i < n; i++) {
    if (ids[i] == d) continue;
    CGRect b = CGDisplayBounds(ids[i]);
    minX = MIN(minX, CGRectGetMinX(b));
    maxY = MAX(maxY, CGRectGetMaxY(b));
  }
  CGRect vb = CGDisplayBounds(d);
  CGDisplayConfigRef cfg;
  if (CGBeginDisplayConfiguration(&cfg) != kCGErrorSuccess) return;
  CGConfigureDisplayOrigin(cfg, d, (int32_t)(minX - vb.size.width), (int32_t)maxY);
  CGCompleteDisplayConfiguration(cfg, kCGConfigureForSession);
}

// Apps `launch` opened, one "pid<TAB>bundle path" per line. When the display
// goes away macOS moves its windows onto the user's screen, so `display` quits
// these apps first. The path guards against a recycled pid.
static NSString *launchedFile(void) {
  return [NSTemporaryDirectory() stringByAppendingPathComponent:@"cc-offscreen-launched"];
}

static void recordLaunch(NSRunningApplication *app) {
  NSString *line = [NSString stringWithFormat:@"%d\t%@\n", app.processIdentifier, app.bundleURL.path];
  NSFileHandle *h = [NSFileHandle fileHandleForWritingAtPath:launchedFile()];
  if (!h) {
    [line writeToFile:launchedFile() atomically:NO encoding:NSUTF8StringEncoding error:nil];
    return;
  }
  [h seekToEndOfFile];
  [h writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
  [h closeFile];
}

static void quitLaunchedApps(void) {
  NSString *all = [NSString stringWithContentsOfFile:launchedFile() encoding:NSUTF8StringEncoding error:nil];
  NSMutableArray<NSRunningApplication *> *apps = [NSMutableArray array];
  for (NSString *line in [all componentsSeparatedByString:@"\n"]) {
    NSArray *f = [line componentsSeparatedByString:@"\t"];
    if (f.count != 2) continue;
    NSRunningApplication *a = [NSRunningApplication runningApplicationWithProcessIdentifier:[f[0] intValue]];
    if (a && [a.bundleURL.path isEqualToString:f[1]]) {
      [a terminate];
      [apps addObject:a];
    }
  }
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while ([deadline timeIntervalSinceNow] > 0) {
    BOOL alive = NO;
    for (NSRunningApplication *a in apps) alive |= !a.terminated;
    if (!alive) break;
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.2]];
  }
  // A test app stuck on a save sheet would otherwise land on the user's screen.
  for (NSRunningApplication *a in apps) if (!a.terminated) [a forceTerminate];
  [NSFileManager.defaultManager removeItemAtPath:launchedFile() error:nil];
}

static int cmdDisplay(int argc, const char **argv) {
  unsigned int w = 1920, h = 1200;
  double idleMinutes = 60;
  for (int i = 0; i < argc; i++) {
    if (!strcmp(argv[i], "--size") && i + 1 < argc) sscanf(argv[++i], "%ux%u", &w, &h);
    else if (!strcmp(argv[i], "--idle-minutes") && i + 1 < argc) idleMinutes = atof(argv[++i]);
  }
  if (findDisplay()) die(@"a virtual display is already running");

  CGVirtualDisplayDescriptor *desc = [CGVirtualDisplayDescriptor new];
  desc.queue = dispatch_get_main_queue();
  desc.name = kDisplayName;
  desc.maxPixelsWide = w;
  desc.maxPixelsHigh = h;
  desc.sizeInMillimeters = CGSizeMake(25.4 * w / 96.0, 25.4 * h / 96.0);
  desc.vendorID = 0xCC;
  desc.productID = 0x0FF;
  desc.serialNum = kSerial;
  void (^stop)(void) = ^{
    quitLaunchedApps();
    [NSFileManager.defaultManager removeItemAtPath:displayPidFile() error:nil];
    exit(0);
  };
  desc.terminationHandler = ^(id a, id b) { stop(); };

  CGVirtualDisplay *display = [[CGVirtualDisplay alloc] initWithDescriptor:desc];
  if (!display) die(@"CGVirtualDisplay init failed (private API unavailable on this macOS?)");

  CGVirtualDisplaySettings *settings = [CGVirtualDisplaySettings new];
  settings.hiDPI = 0;
  settings.modes = @[ [[CGVirtualDisplayMode alloc] initWithWidth:w height:h refreshRate:60] ];
  if (![display applySettings:settings]) die(@"applySettings failed");

  // The display needs a moment to come online before it can be arranged.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    parkDisplay(display.displayID);
    CGRect b = displayBounds(display.displayID);
    out([NSString stringWithFormat:@"display %u up at %.0f,%.0f %.0fx%.0f (stops after %g idle minutes, or `offscreen stop`)",
                                   display.displayID, b.origin.x, b.origin.y, b.size.width, b.size.height, idleMinutes]);
  });

  // An agent that dies mid-run never calls `stop`; without this the display and its apps outlive it.
  if (idleMinutes > 0) {
    dispatch_source_t idle = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(idle, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), 30 * NSEC_PER_SEC, NSEC_PER_SEC);
    dispatch_source_set_event_handler(idle, ^{
      NSDate *touched = [NSFileManager.defaultManager attributesOfItemAtPath:displayPidFile() error:nil].fileModificationDate;
      if (!touched || -[touched timeIntervalSinceNow] > idleMinutes * 60) {
        out(@"display idle; stopping");
        stop();
      }
    });
    dispatch_resume(idle);
    (void)CFBridgingRetain(idle);
  }

  int sigs[] = {SIGINT, SIGTERM, SIGHUP};
  for (int k = 0; k < 3; k++) {
    int sig = sigs[k];
    signal(sig, SIG_IGN);
    dispatch_source_t s = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, sig, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(s, stop);
    dispatch_resume(s);
    (void)CFBridgingRetain(s);
  }
  // Written only once the signal handlers exist, so `stop` works from the first moment it can find us.
  [[NSString stringWithFormat:@"%d", getpid()] writeToFile:displayPidFile() atomically:YES encoding:NSUTF8StringEncoding error:nil];
  (void)CFBridgingRetain(display);
  dispatch_main();
}

// Agents run each shell command in a fresh process, so they stop the display
// by pidfile rather than by a $! they no longer have.
// A stale pidfile can name a pid the OS has since reused, so only signal a
// process running this same binary.
static BOOL isOffscreenProcess(pid_t pid) {
  char theirs[PROC_PIDPATHINFO_MAXSIZE], mine[PROC_PIDPATHINFO_MAXSIZE];
  if (proc_pidpath(pid, theirs, sizeof theirs) <= 0 || proc_pidpath(getpid(), mine, sizeof mine) <= 0) return NO;
  return strcmp(theirs, mine) == 0;
}

static int cmdStop(void) {
  NSString *raw = [NSString stringWithContentsOfFile:displayPidFile() encoding:NSUTF8StringEncoding error:nil];
  pid_t pid = (pid_t)raw.intValue;
  if (pid <= 0 || kill(pid, 0) != 0 || !isOffscreenProcess(pid)) {
    [NSFileManager.defaultManager removeItemAtPath:displayPidFile() error:nil];
    if (findDisplay()) die(@"the display is up but its pidfile is missing; kill its `offscreen display` process with SIGTERM");
    out(@"display none");
    return 0;
  }
  kill(pid, SIGTERM);
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:15];
  while ([deadline timeIntervalSinceNow] > 0 && (kill(pid, 0) == 0 || findDisplay())) usleep(200000);
  if (findDisplay()) die(@"display still up after 15s");
  out(@"display stopped; launched apps quit");
  return 0;
}

// ---------- accessibility helpers ----------

static id axGet(AXUIElementRef el, CFStringRef attr) {
  CFTypeRef v = NULL;
  if (AXUIElementCopyAttributeValue(el, attr, &v) != kAXErrorSuccess || !v) return nil;
  return CFBridgingRelease(v);
}

static NSString *axStr(AXUIElementRef el, CFStringRef attr) {
  id v = axGet(el, attr);
  return [v isKindOfClass:NSString.class] ? v : nil;
}

static NSArray *axWindows(pid_t pid) {
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  NSArray *w = axGet(app, kAXWindowsAttribute) ?: @[];
  CFRelease(app);
  return w;
}

static void requireAX(void) {
  if (!AXIsProcessTrusted())
    die(@"this terminal lacks Accessibility permission (System Settings > Privacy & Security > Accessibility)");
}

static int moveWindowsToDisplay(pid_t pid, CGDirectDisplayID d) {
  int failed = 0;
  CGRect b = displayBounds(d);
  int i = 0;
  for (id w in axWindows(pid)) {
    AXUIElementRef win = (__bridge AXUIElementRef)w;
    i++;
    CGPoint cur = CGPointZero;
    id pos = axGet(win, kAXPositionAttribute);
    if (pos && AXValueGetValue((__bridge AXValueRef)pos, kAXValueCGPointType, &cur) && CGRectContainsPoint(b, cur)) continue;
    CGPoint p = CGPointMake(b.origin.x + 40 + 30 * (i - 1), b.origin.y + 60 + 30 * (i - 1));
    AXValueRef v = AXValueCreate(kAXValueCGPointType, &p);
    AXError err = AXUIElementSetAttributeValue(win, kAXPositionAttribute, v);
    CFRelease(v);
    if (err != kAXErrorSuccess) failed++;
  }
  return failed;
}

// After an action, for a moment: hand focus back if the app took it, and move
// any window it opened onto the virtual display before the user sees it.
static void settle(pid_t pid, NSRunningApplication *front) {
  CGDirectDisplayID d = findDisplay();
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  for (int k = 0; k < 6; k++) {
    if (app.isActive && front && front.processIdentifier != pid) [front activateWithOptions:0];
    if (d) moveWindowsToDisplay(pid, d);
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  }
}

// A label for matching: title, then description, then identifier, then value.
static NSString *axLabel(AXUIElementRef el) {
  CFStringRef attrs[] = {kAXTitleAttribute, kAXDescriptionAttribute, kAXIdentifierAttribute};
  for (int k = 0; k < 3; k++) {
    NSString *s = axStr(el, attrs[k]);
    if (s.length) return s;
  }
  id v = axGet(el, kAXValueAttribute);
  return [v isKindOfClass:NSString.class] ? v : @"";
}

typedef BOOL (^AXVisit)(AXUIElementRef el, int depth);

static BOOL axWalk(AXUIElementRef el, int depth, int maxDepth, AXVisit visit) {
  if (visit(el, depth)) return YES;
  if (depth >= maxDepth) return NO;
  for (id c in axGet(el, kAXChildrenAttribute) ?: @[]) {
    if (axWalk((__bridge AXUIElementRef)c, depth + 1, maxDepth, visit)) return YES;
  }
  return NO;
}

static AXUIElementRef axFind(pid_t pid, NSString *query, NSString *role) {
  __block AXUIElementRef found = NULL;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  axWalk(app, 0, 40, ^BOOL(AXUIElementRef el, int depth) {
    if (role && ![axStr(el, kAXRoleAttribute) isEqualToString:role]) return NO;
    NSString *l = axLabel(el);
    if ([l isEqualToString:query] || [axStr(el, kAXTitleAttribute) isEqualToString:query] ||
        [axStr(el, kAXDescriptionAttribute) isEqualToString:query] ||
        [axStr(el, kAXIdentifierAttribute) isEqualToString:query]) {
      found = (AXUIElementRef)CFRetain(el);
      return YES;
    }
    return NO;
  });
  CFRelease(app);
  return found;
}

static pid_t parsePid(const char *s) {
  pid_t pid = (pid_t)atoi(s);
  if (pid <= 0 || ![NSRunningApplication runningApplicationWithProcessIdentifier:pid]) die(@"no running app with that pid");
  return pid;
}

// ---------- commands ----------

static int cmdLaunch(int argc, const char **argv) {
  if (argc < 1) die(@"usage: offscreen launch <App.app> [-- args...]");
  requireAX();
  CGDirectDisplayID d = requireDisplay();
  NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[0]]];
  // Skip window restoration so one run's windows never reopen in the next.
  NSMutableArray *args = [NSMutableArray arrayWithObjects:@"-ApplePersistenceIgnoreState", @"YES", nil];
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--")) continue;
    [args addObject:[NSString stringWithUTF8String:argv[i]]];
  }
  NSWorkspaceOpenConfiguration *cfg = [NSWorkspaceOpenConfiguration configuration];
  cfg.activates = NO;
  cfg.addsToRecentItems = NO;
  cfg.createsNewApplicationInstance = YES;
  cfg.arguments = args;
  cfg.environment = @{@"CC_OFFSCREEN" : @"1"};

  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  __block NSRunningApplication *app = nil;
  __block NSError *err = nil;
  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  [NSWorkspace.sharedWorkspace openApplicationAtURL:url
                                      configuration:cfg
                                  completionHandler:^(NSRunningApplication *a, NSError *e) {
                                    app = a;
                                    err = e;
                                    dispatch_semaphore_signal(sem);
                                  }];
  while (dispatch_semaphore_wait(sem, DISPATCH_TIME_NOW)) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  if (!app) die([NSString stringWithFormat:@"launch failed: %@", err.localizedDescription]);
  recordLaunch(app);

  // Move windows as they appear; also hand focus back if the app activated itself.
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:15];
  BOOL sawWindow = NO;
  int lastFailed = 0;
  while ([deadline timeIntervalSinceNow] > 0) {
    if (app.isActive && front && front.processIdentifier != app.processIdentifier)
      [front activateWithOptions:0];
    if (axWindows(app.processIdentifier).count) {
      lastFailed = moveWindowsToDisplay(app.processIdentifier, d);
      if (sawWindow) break;
      sawWindow = YES;
    }
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.5]];
  }
  if (lastFailed) fprintf(stderr, "offscreen: %d window(s) of pid %d could not be moved and may be on your screen; run `offscreen park %d`\n", lastFailed, app.processIdentifier, app.processIdentifier);
  if (!sawWindow) fprintf(stderr, "offscreen: no window yet; run `offscreen park %d` once one opens\n", app.processIdentifier);
  out([NSString stringWithFormat:@"%d", app.processIdentifier]);
  return 0;
}

static int cmdPark(int argc, const char **argv) {
  if (argc < 1) die(@"usage: offscreen park <pid>");
  requireAX();
  pid_t pid = parsePid(argv[0]);
  int failed = moveWindowsToDisplay(pid, requireDisplay());
  if (failed) die([NSString stringWithFormat:@"%d window(s) of pid %d could not be moved onto the virtual display; they may be on your screen", failed, pid]);
  return 0;
}

static int cmdTree(int argc, const char **argv) {
  if (argc < 1) die(@"usage: offscreen tree <pid> [depth]");
  requireAX();
  pid_t pid = parsePid(argv[0]);
  int maxDepth = argc > 1 ? atoi(argv[1]) : 12;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  axWalk(app, 0, maxDepth, ^BOOL(AXUIElementRef el, int depth) {
    NSString *role = axStr(el, kAXRoleAttribute) ?: @"?";
    NSString *ident = axStr(el, kAXIdentifierAttribute);
    NSString *label = axLabel(el);
    printf("%*s%s", depth * 2, "", role.UTF8String);
    if (label.length) printf(" \"%s\"", [label stringByReplacingOccurrencesOfString:@"\n" withString:@" "].UTF8String);
    if (ident.length && ![ident isEqualToString:label]) printf(" #%s", ident.UTF8String);
    printf("\n");
    return NO;
  });
  CFRelease(app);
  return 0;
}

static int cmdPress(int argc, const char **argv) {
  if (argc < 2) die(@"usage: offscreen press <pid> <title|description|identifier> [role]");
  requireAX();
  pid_t pid = parsePid(argv[0]);
  NSString *role = argc > 2 ? [NSString stringWithUTF8String:argv[2]] : nil;
  AXUIElementRef el = axFind(pid, [NSString stringWithUTF8String:argv[1]], role);
  if (!el) die(@"element not found (see `offscreen tree <pid>`)");
  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  AXError e = AXUIElementPerformAction(el, kAXPressAction);
  CFRelease(el);
  if (e != kAXErrorSuccess) die([NSString stringWithFormat:@"AXPress failed (%d)", e]);
  settle(pid, front);
  return 0;
}

static int cmdSet(int argc, const char **argv) {
  if (argc < 3) die(@"usage: offscreen set <pid> <title|description|identifier> <text>");
  requireAX();
  pid_t pid = parsePid(argv[0]);
  AXUIElementRef el = axFind(pid, [NSString stringWithUTF8String:argv[1]], nil);
  if (!el) die(@"element not found (see `offscreen tree <pid>`)");
  AXError e = AXUIElementSetAttributeValue(el, kAXValueAttribute, (__bridge CFStringRef)[NSString stringWithUTF8String:argv[2]]);
  CFRelease(el);
  if (e != kAXErrorSuccess) die([NSString stringWithFormat:@"setting value failed (%d)", e]);
  return 0;
}

static int cmdMenu(int argc, const char **argv) {
  if (argc < 2) die(@"usage: offscreen menu <pid> <Menu> [<Item> ...]");
  requireAX();
  pid_t pid = parsePid(argv[0]);
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  id cur = axGet(app, kAXMenuBarAttribute);
  CFRelease(app);
  for (int i = 1; i < argc && cur; i++) {
    NSString *want = [NSString stringWithUTF8String:argv[i]];
    id next = nil;
    NSMutableArray *queue = [NSMutableArray arrayWithArray:axGet((__bridge AXUIElementRef)cur, kAXChildrenAttribute) ?: @[]];
    // Menu bar items hold a menu whose children are the items; search two levels.
    while (queue.count && !next) {
      id c = queue.firstObject;
      [queue removeObjectAtIndex:0];
      if ([axStr((__bridge AXUIElementRef)c, kAXTitleAttribute) isEqualToString:want]) next = c;
      else if ([axStr((__bridge AXUIElementRef)c, kAXRoleAttribute) isEqualToString:@"AXMenu"])
        [queue addObjectsFromArray:axGet((__bridge AXUIElementRef)c, kAXChildrenAttribute) ?: @[]];
    }
    if (!next) die([NSString stringWithFormat:@"menu item \"%@\" not found", want]);
    cur = next;
  }
  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  AXError e = AXUIElementPerformAction((__bridge AXUIElementRef)cur, kAXPressAction);
  if (e != kAXErrorSuccess) die([NSString stringWithFormat:@"menu press failed (%d)", e]);
  settle(pid, front);
  return 0;
}

// Menu commands such as File > Close act on the key window, which a never-activated
// app does not have; the window's own close button works without focus.
static int cmdClose(int argc, const char **argv) {
  if (argc < 1) die(@"usage: offscreen close <pid> [window title]");
  requireAX();
  pid_t pid = parsePid(argv[0]);
  NSString *title = argc > 1 ? [NSString stringWithUTF8String:argv[1]] : nil;
  for (id w in axWindows(pid)) {
    AXUIElementRef win = (__bridge AXUIElementRef)w;
    if (title && ![axStr(win, kAXTitleAttribute) isEqualToString:title]) continue;
    id button = axGet(win, kAXCloseButtonAttribute);
    if (!button) die(@"window has no close button");
    NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
    AXError e = AXUIElementPerformAction((__bridge AXUIElementRef)button, kAXPressAction);
    if (e != kAXErrorSuccess) die([NSString stringWithFormat:@"close failed (%d)", e]);
    settle(pid, front);
    return 0;
  }
  die(@"no matching window");
  return 1;
}

// Key events go straight to the process, never through the system event stream.
static void postKey(pid_t pid, CGKeyCode code, const UniChar *chars, UniCharCount len, CGEventFlags flags) {
  for (int down = 1; down >= 0; down--) {
    CGEventRef ev = CGEventCreateKeyboardEvent(NULL, code, down);
    if (len) CGEventKeyboardSetUnicodeString(ev, len, chars);
    CGEventSetFlags(ev, flags);
    CGEventPostToPid(pid, ev);
    CFRelease(ev);
    usleep(8000);
  }
}

static int cmdType(int argc, const char **argv) {
  if (argc < 2) die(@"usage: offscreen type <pid> <text>");
  requireAX();
  pid_t pid = parsePid(argv[0]);
  NSString *s = [NSString stringWithUTF8String:argv[1]];
  // One event per composed character, so emoji and accented letters arrive whole.
  [s enumerateSubstringsInRange:NSMakeRange(0, s.length)
                        options:NSStringEnumerationByComposedCharacterSequences
                     usingBlock:^(NSString *ch, NSRange r, NSRange er, BOOL *stop) {
                       if ([ch isEqualToString:@"\n"]) {
                         postKey(pid, 36, NULL, 0, 0);
                         return;
                       }
                       UniChar buf[16];
                       UniCharCount n = MIN(ch.length, (NSUInteger)16);
                       [ch getCharacters:buf range:NSMakeRange(0, n)];
                       postKey(pid, 0, buf, n, 0);
                     }];
  return 0;
}

static int cmdKey(int argc, const char **argv) {
  if (argc < 2) die(@"usage: offscreen key <pid> <combo>  e.g. return, escape, tab, cmd+n, cmd+shift+k");
  requireAX();
  pid_t pid = parsePid(argv[0]);
  NSArray *parts = [[NSString stringWithUTF8String:argv[1]].lowercaseString componentsSeparatedByString:@"+"];
  CGEventFlags flags = 0;
  NSDictionary *mods = @{@"cmd" : @(kCGEventFlagMaskCommand), @"shift" : @(kCGEventFlagMaskShift),
                         @"opt" : @(kCGEventFlagMaskAlternate), @"alt" : @(kCGEventFlagMaskAlternate),
                         @"ctrl" : @(kCGEventFlagMaskControl)};
  NSDictionary *named = @{@"return" : @36, @"enter" : @36, @"tab" : @48, @"space" : @49, @"delete" : @51,
                          @"escape" : @53, @"esc" : @53, @"left" : @123, @"right" : @124, @"down" : @125, @"up" : @126};
  // ANSI virtual key codes for letters and digits, so shortcuts match by key, not by layout.
  NSString *letters = @"asdfhgzxcv_bqweryt123465=97-80]ou[ip_lj'k;\\,/nm.";
  for (NSString *p in [parts subarrayWithRange:NSMakeRange(0, parts.count - 1)]) {
    if (!mods[p]) die([NSString stringWithFormat:@"unknown modifier %@", p]);
    flags |= [mods[p] unsignedLongLongValue];
  }
  NSString *k = parts.lastObject;
  CGKeyCode code = 0;
  UniChar ch = 0;
  if (named[k]) code = [named[k] unsignedShortValue];
  else if (k.length == 1 && [letters rangeOfString:k].location != NSNotFound) {
    code = (CGKeyCode)[letters rangeOfString:k].location;
    ch = [k characterAtIndex:0];
  } else die([NSString stringWithFormat:@"unknown key %@", k]);
  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  postKey(pid, code, ch ? &ch : NULL, ch ? 1 : 0, flags);
  settle(pid, front);
  return 0;
}

static int cmdShot(int argc, const char **argv) {
  if (argc < 2) die(@"usage: offscreen shot <pid> <out.png>");
  if (!CGPreflightScreenCaptureAccess()) die(@"this terminal lacks Screen Recording permission (System Settings > Privacy & Security > Screen Recording)");
  pid_t pid = parsePid(argv[0]);
  // On-screen windows come back front to back, so the first one is the app's front window.
  NSArray *wins = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  NSNumber *wid = nil;
  for (NSDictionary *w in wins) {
    if ([w[(id)kCGWindowOwnerPID] intValue] == pid && [w[(id)kCGWindowLayer] intValue] == 0) {
      wid = w[(id)kCGWindowNumber];
      break;
    }
  }
  if (!wid) die(@"no window to capture");
  NSTask *t = [NSTask launchedTaskWithLaunchPath:@"/usr/sbin/screencapture"
                                       arguments:@[ @"-x", @"-o", [NSString stringWithFormat:@"-l%@", wid], [NSString stringWithUTF8String:argv[1]] ]];
  [t waitUntilExit];
  return t.terminationStatus;
}

static int cmdStatus(void) {
  CGDirectDisplayID d = findDisplay();
  CGEventRef e = CGEventCreate(NULL);
  CGPoint c = CGEventGetLocation(e);
  CFRelease(e);
  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (d) {
    CGRect b = displayBounds(d);
    out([NSString stringWithFormat:@"display %u at %.0f,%.0f %.0fx%.0f", d, b.origin.x, b.origin.y, b.size.width, b.size.height]);
  } else out(@"display none");
  out([NSString stringWithFormat:@"cursor %.0f,%.0f", c.x, c.y]);
  out([NSString stringWithFormat:@"frontmost %@ (%d)", front.bundleIdentifier, front.processIdentifier]);
  out([NSString stringWithFormat:@"accessibility %@", AXIsProcessTrusted() ? @"granted" : @"missing"]);
  out([NSString stringWithFormat:@"screen-recording %@", CGPreflightScreenCaptureAccess() ? @"granted" : @"missing"]);
  return 0;
}

int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr,
              "usage: offscreen <command>\n"
              "  display [--size WxH] [--idle-minutes N]  create the virtual display; runs until `stop` or N idle minutes (60)\n"
              "  stop                     quit the apps `launch` opened, then remove the display\n"
              "  status                   display, cursor, frontmost app, permissions\n"
              "  launch <App.app> [-- args] open without activating, move windows to the display, print pid\n"
              "  park <pid>               move the app's windows to the display\n"
              "  tree <pid> [depth]       print the accessibility tree\n"
              "  press <pid> <label> [role]  AXPress the element whose title/description/identifier matches\n"
              "  set <pid> <label> <text> set a text field's value\n"
              "  menu <pid> <Menu> <Item>...  pick a menu item through accessibility\n"
              "  close <pid> [title]      press a window's close button (first window if no title)\n"
              "  type <pid> <text>        send keystrokes to the process only\n"
              "  key <pid> <combo>        send a key or shortcut to the process only (cmd+n, return)\n"
              "  shot <pid> <out.png>     capture the app's front window\n");
      return 64;
    }
    const char *c = argv[1];
    int n = argc - 2;
    const char **a = argv + 2;
    if (!strcmp(c, "display")) return cmdDisplay(n, a);
    if (!strcmp(c, "status")) return cmdStatus();
    if (!strcmp(c, "stop")) return cmdStop();
    if (!strcmp(c, "launch")) return cmdLaunch(n, a);
    if (!strcmp(c, "park")) return cmdPark(n, a);
    if (!strcmp(c, "tree")) return cmdTree(n, a);
    if (!strcmp(c, "press")) return cmdPress(n, a);
    if (!strcmp(c, "set")) return cmdSet(n, a);
    if (!strcmp(c, "menu")) return cmdMenu(n, a);
    if (!strcmp(c, "close")) return cmdClose(n, a);
    if (!strcmp(c, "type")) return cmdType(n, a);
    if (!strcmp(c, "key")) return cmdKey(n, a);
    if (!strcmp(c, "shot")) return cmdShot(n, a);
    die([NSString stringWithFormat:@"unknown command %s", c]);
  }
  return 1;
}
