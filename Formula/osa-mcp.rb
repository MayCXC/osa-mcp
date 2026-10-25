class OsaMcp < Formula
  desc "MCP server for the AppleScript dictionaries of scriptable macOS apps"
  homepage "https://github.com/MayCXC/osa-mcp"
  version "0.4.1"
  license "BSD-3-Clause"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-arm64"
      sha256 "e4f832d681ac12b6bdc93552514d1b9c67fb6d559cee99d9e1b776fa950ac390"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-x64"
      sha256 "4f726eb8c464455a5f863bf8458a5e934bdf8a6799edaa5605c79402474d5f90"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-arm64"
      sha256 "f60d358dea69f53ffa3f88f924b668efd7eb530e3ba4c02e6cd97911d966b78a"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-x64"
      sha256 "83f37d5da060d16ef5858e8cde6f7404ac63d90e0bf0e07a6eea37cca5bc1cf0"
    end
  end

  def install
    bin.install Dir["osa-mcp*"].first => "osa-mcp"
  end

  test do
    assert_match "osa-mcp", shell_output("#{bin}/osa-mcp --help")
  end
end
