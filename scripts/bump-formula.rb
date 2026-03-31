require "digest"
require "erb"

version = ARGV[0]
release_dir = ARGV[1]
abort "Usage: ruby scripts/bump-formula.rb <version> [release-dir]" unless version

version = version.delete_prefix("v")

shas = %w[darwin-arm64 darwin-x64 linux-arm64 linux-x64].to_h do |platform|
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

template_path = File.join(__dir__, "..", "Formula", "osa-mcp.rb.erb")
formula_path = File.join(__dir__, "..", "Formula", "osa-mcp.rb")
template = ERB.new(File.read(template_path))
File.write(formula_path, template.result(binding))
puts "Updated #{formula_path}"
