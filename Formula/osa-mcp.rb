class OsaMcp < Formula
  desc "MCP server for the AppleScript dictionaries of scriptable macOS apps"
  homepage "https://github.com/MayCXC/osa-mcp"
  version "0.3.0"
  license "BSD-3-Clause"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-arm64"
      sha256 "76f9037f0ffc78fbfca74a3690520c8a3ce90ff46f6953ae0ea05604e8d3a5b7"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-x64"
      sha256 "7a74bb41fe876207128c4a2ad950c8eddf862f09065e2c64d52aaefbe8a8a0ee"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-arm64"
      sha256 "67b27fb2868ced82daec606c0fe11fcfa3e41ee2e78018aed69400f9ee36bca3"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-x64"
      sha256 "0894a198f3c8d1a7e65fce6659b7f61890dfe37972cf92ab846b1ac3c573e2ce"
    end
  end

  def install
    bin.install Dir["osa-mcp*"].first => "osa-mcp"
  end

  test do
    assert_match "osa-mcp", shell_output("#{bin}/osa-mcp --help")
  end
end
