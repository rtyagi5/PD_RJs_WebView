import { Dumbbell, User, ArrowDownUp, Settings2 } from "lucide-react";

export default function MiniSquatsSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900 text-center">
                🏋️ Mini Squats – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-start justify-center space-x-2">
                    <Dumbbell className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    No equipment required. Optional: use a chair, wall, or railing nearby for support if needed.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-start justify-center space-x-2">
                    <User className="w-5 h-5 text-green-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Stand upright with <span className="font-medium">feet hip-width apart</span>,
                    toes pointing slightly forward. Keep your chest upright.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-start justify-center space-x-2">
                    <ArrowDownUp className="w-5 h-5 text-yellow-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Bend your knees slightly to go <span className="font-medium">down</span>,
                    then push through your heels to come back <span className="font-medium">up</span>.
                    Movement should be controlled and within a small range.
                </p>
            </div>

            {/* Basic Setup */}
            <div className="bg-purple-50 p-4 rounded-lg flex flex-col gap-3">
                <div className="flex items-start justify-center space-x-2">
                    <Settings2 className="w-5 h-5 text-purple-600" />
                    <h3 className="text-base font-semibold text-gray-800">Basic Setup</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 text-left">
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Keep your back straight and core engaged.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Lower only a few inches (mini squat), not full depth.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Ensure knees track over your toes, not inward.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Hold onto a stable surface if balance is an issue.</li>
                </ul>
            </div>
        </div>
    );
}
