class OsaMcp < Formula
  desc "MCP server for the AppleScript dictionaries of scriptable macOS apps"
  homepage "https://github.com/MayCXC/osa-mcp"
  version "0.4.0"
  license "BSD-3-Clause"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-arm64"
      sha256 "e919f5d274d2530e61a3f7724a347affb7fc5ef57de695c7e0424e1c56b236c9"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-x64"
      sha256 "4dc55f35370c90489d3244ebd82e01fcf73ba370f7345ed598f1b89e2fa5a8c9"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-arm64"
      sha256 "325c2787c31c3d87098f50cbcb7a097e6d6c612b1e2d311ed32b0439ef738290"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-x64"
      sha256 "77750359b039b7a1c4da4410a85b974e1534244f2c88c4cc3e3e5e4195fc6639"
    end
  end

  def install
    bin.install Dir["osa-mcp*"].first => "osa-mcp"
  end

  test do
    assert_match "osa-mcp", shell_output("#{bin}/osa-mcp --help")
  end
end
