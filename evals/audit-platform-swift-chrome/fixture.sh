#!/usr/bin/env bash
set -euo pipefail

mkdir -p Sources/App

cat > CHARACTER.md <<'MD'
# Character sheet

- Accent: `BrandAccent` (asset catalog), used for branded touches only.
- Motion signature: `.spring(duration: 0.35, bounce: 0.2)` on the add-item confirmation.
MD

cat > Info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Pantry</string>
  <key>UIDesignRequiresCompatibility</key>
  <true/>
</dict>
</plist>
PLIST

cat > Sources/App/PantryApp.swift <<'SWIFT'
import SwiftUI

@main
struct PantryApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var tab = 0
    var body: some View {
        ZStack(alignment: .bottom) {
            if tab == 0 { HomeView() } else { Text("Settings") }
            CustomTabBar(selection: $tab)
        }
    }
}
SWIFT

cat > Sources/App/CustomTabBar.swift <<'SWIFT'
import SwiftUI

struct CustomTabBar: View {
    @Binding var selection: Int
    var body: some View {
        HStack {
            tabButton("house", index: 0)
            tabButton("gearshape", index: 1)
        }
        .padding(.vertical, 12)
        .background(Rectangle().fill(Color.white.opacity(0.7)))
        .cornerRadius(18)
        .padding(.horizontal, 24)
    }

    private func tabButton(_ symbol: String, index: Int) -> some View {
        Button { selection = index } label: {
            Image(systemName: symbol)
                .foregroundColor(selection == index ? Color(red: 0.95, green: 0.4, blue: 0.2) : .gray)
                .frame(maxWidth: .infinity)
        }
    }
}
SWIFT

cat > Sources/App/HomeView.swift <<'SWIFT'
import SwiftUI

struct HomeView: View {
    @State private var added = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Pantry")
                    .font(.custom("Futura", size: 34))
                    .foregroundColor(Color(red: 0.1, green: 0.1, blue: 0.12))
                Spacer()
                Button { withAnimation(.spring(duration: 0.35, bounce: 0.2)) { added.toggle() } } label: {
                    Image(systemName: "plus.circle.fill")
                        .foregroundStyle(Color("BrandAccent"))
                }
            }
            Text("3 items expire this week")
                .font(.system(size: 15))
                .foregroundColor(Color(red: 0.45, green: 0.45, blue: 0.5))
        }
        .padding(20)
    }
}
SWIFT
