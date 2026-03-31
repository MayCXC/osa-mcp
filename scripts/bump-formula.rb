require "digest"

version = ARGV[0]
release_dir = ARGV[1]
abort "Usage: ruby scripts/bump-formula.rb <version> [release-dir]" unless version

version = version.delete_prefix("v")
formula_path = File.join(__dir__, "..", "Formula", "osa-mcp.rb")

# Try Homebrew's Inreplace, fall back to manual sub
begin
  require "utils/inreplace"
  use_inreplace = true
rescue LoadError
  use_inreplace = false
end

platforms = %w[darwin-arm64 darwin-x64 linux-arm64 linux-x64]

shas = platforms.to_h do |platform|
  if release_dir
    path = File.join(release_dir, "osa-mcp-#{platform}")
    abort "Missing binary: #{path}" unless File.exist?(path)
    sha = Digest::SHA256.file(path).hexdigest
  else
    require "net/http"
    url = "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-#{platform}"
    puts "Fetching #{url}..."
    uri = URI(url)
    response = Net::HTTP.get_response(uri)
    response = Net::HTTP.get_response(URI(response["location"])) while response.is_a?(Net::HTTPRedirection)
    abort "Failed to fetch #{platform}: #{response.code}" unless response.is_a?(Net::HTTPSuccess)
    sha = Digest::SHA256.hexdigest(response.body)
  end
  puts "  #{platform}: #{sha}"
  [platform, sha]
end

if use_inreplace
  Utils::Inreplace.inreplace formula_path do |s|
    s.gsub!(/version "[^"]*"/, "version \"#{version}\"")
    shas.each do |platform, sha|
      s.gsub!(/(osa-mcp-#{Regexp.escape(platform)}.*?\n\s+sha256 )"[^"]*"/, "\\1\"#{sha}\"")
    end
  end
else
  formula = File.read(formula_path)
  formula.sub!(/version "[^"]*"/, "version \"#{version}\"")
  shas.each do |platform, sha|
    formula.sub!(/(osa-mcp-#{Regexp.escape(platform)}.*?\n\s+sha256 )"[^"]*"/) { "#{$1}\"#{sha}\"" }
  end
  File.write(formula_path, formula)
end

puts "Updated #{formula_path}"
