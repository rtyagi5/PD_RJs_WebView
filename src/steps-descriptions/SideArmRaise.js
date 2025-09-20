import { Dumbbell, User, ArrowLeftRight, Settings2 } from "lucide-react";

export default function SideArmRaiseSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900">
                🏋️ Side Arm Raise – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Dumbbell className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600">
                    No equipment required. Optional: light dumbbells for added resistance.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <User className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600">
                    Stand upright with feet shoulder-width apart. Face slightly{" "}
                    <span className="font-medium">diagonal to the camera</span> for better tracking.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <ArrowLeftRight className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600">
                    Raise your <span className="font-medium">left arm to the left</span> and{" "}
                    <span className="font-medium">right arm to the right</span>, keeping elbows straight.
                </p>
            </div>

            {/* Basic Setup */}
            <div className="bg-purple-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Settings2 className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Basic Setup</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 text-left">
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Stand or sit upright with a straight back.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Keep arms relaxed at your sides.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Engage your core for balance.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Ensure enough space on both sides to move arms freely.</li>
                </ul>
            </div>
        </div>
    );
}
