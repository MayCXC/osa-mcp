class OsaMcp < Formula
  desc "MCP server for the AppleScript dictionaries of scriptable macOS apps"
  homepage "https://github.com/MayCXC/osa-mcp"
  version "0.4.2"
  license "BSD-3-Clause"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-arm64"
      sha256 "5bf041e83fa6021ffd255c56a051f47e8ed5c371b14c3e17d3abe3793608eb62"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-x64"
      sha256 "bccdfa738a5c1fbf54c155fe6154d791ac44bede2e6023295e7f6629e9c46ad8"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-arm64"
      sha256 "341e7e23efc70b82b6520837dc7d6d1866d2cf7e95c56e000930381cb1b2e83f"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-x64"
      sha256 "5700fa1a318a6ac6fa0e72eca0161fa284117ef9e0c88158b4acb3168477b0ad"
    end
  end

  def install
    bin.install Dir["osa-mcp*"].first => "osa-mcp"
  end

  test do
    assert_match "osa-mcp", shell_output("#{bin}/osa-mcp --help")
  end
end
