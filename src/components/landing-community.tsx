import { Button } from "@/components/ui/button";
import { Github, Twitter, DiscIcon as Discord } from "lucide-react";
import Link from "next/link";

export default function Community() {
  return (
    <section id="community" className="py-20 border-t border-white/10">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Join our community</h2>
          <p className="text-gray-400 mb-8">
            VideoSOS is an open-source project. Star us on GitHub and contribute
            to help shape the future of AI-powered video editing.
          </p>

          <div className="flex justify-center">
            <Link href="https://github.com/timoncool/video-starter-kit">
              <Button variant="outline" size="lg">
                <Github className="mr-2 h-5 w-5" />
                Star on GitHub
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
